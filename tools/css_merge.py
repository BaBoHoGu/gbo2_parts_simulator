# -*- coding: utf-8 -*-
# 쓰는 법: python -I tools/css_merge.py src/style.css [--dry]  — 고친 뒤 cssdiff · cstyle_diff 로 0 을 확인할 것
# CSS 9단계 — 겹겹이 덧붙인 규칙을 **결과가 바뀔 수 없는 방법으로만** 줄인다.
#
# 맨 바깥(@media 밖)에서 같은 셀렉터 목록 A(앞)·B(뒤) 짝마다 셋을 차례로 해 본다.
#  ① 죽은 선언 지우기 — A 의 속성 X 를 B 가 같은 이름으로 다시 정하면(중요도가 같거나 높으면)
#     A 의 X 는 어떤 요소에서도 못 이긴다(같은 셀렉터 = 같은 특이도, B 가 뒤). 지운다.
#     A 가 비면 A 를 없애고 A 의 설명 주석은 B 앞으로 옮긴다(이유는 실제로 걸리는 규칙 곁에).
#  ② 위로 합치기 — A~B 사이 어떤 규칙도 B 의 속성 갈래를 안 정하면 B 를 A 끝에 붙인다.
#  ③ 아래로 합치기 — A~B 사이 어떤 규칙도 A 의 속성 갈래를 안 정하면 A 를 B 앞머리에 붙인다.
# 갈래는 넉넉하게 묶는다(font ⊃ line-height, inset ⊃ top…, border-radius → border).
import io, re, sys

P = sys.argv[1]
DRY = '--dry' in sys.argv
src = io.open(P, encoding='utf-8', newline='').read()
NL = '\r\n' if '\r\n' in src else '\n'

def mask(s):
    return re.sub(r'/\*.*?\*/', lambda m: re.sub(r'[^\n]', ' ', m.group(0)), s, flags=re.S)

def decls(s, a, b, t=None):
    """s[a:b] 본문의 선언들: (시작, 끝(; 포함 또는 본문 끝), 속성, important)"""
    if t is None: t = mask(s)
    out, depth, st = [], 0, a
    for i in range(a, b + 1):
        ch = t[i] if i < b else ';'
        if ch in '([': depth += 1
        elif ch in ')])': depth -= 1
        if ch == ';' and depth == 0:
            seg = t[st:i]
            k = len(seg) - len(seg.lstrip())
            ds = st + k
            if ':' in seg:
                p = seg.split(':', 1)[0].strip().lower()
                imp = '!important' in seg.replace(' ', '')
                out.append((ds, min(i + 1, b), p, imp))
            st = i + 1
    return out

def parse(s):
    t = mask(s)
    rules, stack, seg = [], [], 0
    for i, c in enumerate(t):
        if c == '{':
            sel = t[seg:i].strip()
            st = seg + (len(t[seg:i]) - len(t[seg:i].lstrip()))
            stack.append(sel)
            rules.append({'start': st, 'ob': i, 'sel': sel, 'depth': len(stack) - 1, 'at': sel.startswith('@'),
                          'in_kf': any('keyframes' in x for x in stack[:-1])})
            seg = i + 1
        elif c == '}':
            for r in reversed(rules):
                if 'end' not in r:
                    r['end'] = i + 1; break
            stack.pop(); seg = i + 1
        elif c == ';' and stack:
            seg = i + 1
    for r in rules:
        r['nested'] = '{' in t[r['ob'] + 1:r['end'] - 1]
        r['d'] = [] if (r['at'] or r['nested']) else decls(s, r['ob'] + 1, r['end'] - 1, t)
        r['props'] = [x[2] for x in r['d']]
    return rules

def fam(p):
    p = re.sub(r'^-(webkit|moz|ms|o)-', '', p)
    if p.startswith('--'): return {p}
    if p == 'all': return {'*'}
    if p in ('inset', 'top', 'right', 'bottom', 'left') or p.startswith('inset-'): return {'pos'}
    if p in ('gap', 'row-gap', 'column-gap', 'grid-gap', 'grid-row-gap', 'grid-column-gap'): return {'gap'}
    if p.split('-')[0] in ('place', 'align', 'justify'): return {'align'}
    if p == 'line-height' or p.split('-')[0] == 'font': return {'font'}
    return {p.split('-')[0]}

def fams(props):
    out = set()
    for p in props: out |= fam(p)
    return out

def clash(fa, fb):
    return bool(fa & fb) or '*' in fa or '*' in fb

def norm(sel): return ' '.join(sel.split())

def between_clash(rules, a, b, fs):
    for r in rules:
        if r['start'] >= a['end'] and r['end'] <= b['start'] and not r['at'] and not r['in_kf']:
            if clash(fs, fams(r['props'])): return True
    return False

def lead_comment(s, pos):
    """pos 바로 앞의 주석 덩어리 시작(공백만 사이) — 없으면 pos"""
    pre = s[:pos]
    m = re.search(r'((?:/\*(?:(?!\*/).)*\*/\s*)+)$', pre, flags=re.S)
    return pos - len(m.group(1)) if m else pos

def cut_line_end(s, e):
    if s[e:e + 2] == '\r\n': return e + 2
    if s[e:e + 1] == '\n': return e + 1
    return e

def indent_block(txt):
    # 상대 들여쓰기를 지킨다 — 첫 줄은 앞 공백이 이미 잘려 있으니 둘째 줄부터 공통 들여쓰기만 뺀다
    lines = txt.replace('\r\n', '\n').split('\n')
    rest = [x for x in lines[1:] if x.strip()]
    cut = min((len(x) - len(x.lstrip(' ')) for x in rest), default=0)
    out = []
    for i, x in enumerate(lines):
        if not x.strip(): out.append(''); continue
        out.append('  ' + (x.strip() if i == 0 else x[cut:].rstrip()))
    return NL.join(out)

stats = {'dead': 0, 'emptied': 0, 'up': 0, 'down': 0}
done_pairs = set()

def step(s):
    rules = parse(s)
    top = [r for r in rules if r['depth'] == 0 and not r['at'] and not r['nested']]
    last = {}
    for b in top:
        k = norm(b['sel'])
        a = last.get(k); last[k] = b
        if not a: continue
        # ① 죽은 선언
        bimp = {}
        for (_, _, p, imp) in b['d']:
            bimp[p] = bimp.get(p, False) or imp
        dead = [d for d in a['d'] if d[2] in bimp and (bimp[d[2]] or not d[3])]
        if dead:
            live = [d for d in a['d'] if d not in dead]
            if not live:
                # A 를 통째로 없애고, A 앞 주석 + A 본문 안 주석을 B 앞으로
                cs = lead_comment(s, a['start'])
                lead = s[cs:a['start']].strip()
                # 본문 안 주석은 **제 줄을 차지한 것만** 옮긴다. 선언 뒤에 붙은 주석은 그 (죽은) 값의 설명이라 버린다.
                inner = NL.join(m.group(1).strip() for m in re.finditer(r'(?m)^[ \t]*(/\*.*?\*/)[ \t]*$', s[a['ob'] + 1:a['end'] - 1], flags=re.S))
                moved = (lead + (NL if lead and inner else '') + inner).strip()
                bs = lead_comment(s, b['start'])
                ins = (moved + NL) if moved else ''
                e = cut_line_end(s, a['end'])
                s = s[:cs] + s[e:bs] + ins + s[bs:]
                stats['emptied'] += 1; stats['dead'] += len(dead)
                return s, 'A 비움: ' + k[:60]
            for (ds, de, p, imp) in sorted(dead, reverse=True):
                ls = s.rfind('\n', 0, ds) + 1                     # 그 줄의 처음
                le = s.find('\n', de); le = len(s) if le < 0 else le + 1
                before, after = s[ls:ds], s[de:le]
                # 줄에 이 선언만 있으면(뒤에 붙은 설명 주석까지) 줄째 지운다 — 빈 줄·고아 주석을 안 남긴다
                if not before.strip() and re.fullmatch(r'\s*(/\*.*?\*/)?\s*', after, flags=re.S):
                    s = s[:ls] + s[le:]
                else:
                    e = de
                    while e < len(s) and s[e] in ' \t': e += 1
                    s = s[:ds] + s[e:]
            stats['dead'] += len(dead)
            return s, '죽은 선언 %d: %s' % (len(dead), k[:60])
        key = (k, a['start'])
        if key in done_pairs: continue
        # ② 위로
        if not between_clash(rules, a, b, fams(b['props'])):
            bs = lead_comment(s, b['start'])
            cmt = s[bs:b['start']].strip()
            body = s[b['ob'] + 1:b['end'] - 1].strip()
            abody = s[a['ob'] + 1:a['end'] - 1].rstrip()
            sep = '' if (not abody.strip() or mask(abody).rstrip().endswith(';')) else ';'
            add = (NL + indent_block(cmt) if cmt else '') + NL + indent_block(body)
            newA = s[a['start']:a['ob'] + 1] + abody + sep + add + NL + '}'
            e = cut_line_end(s, b['end'])
            s = s[:a['start']] + newA + s[a['end']:bs] + s[e:]
            stats['up'] += 1
            return s, '위로: ' + k[:60]
        # ③ 아래로
        if not between_clash(rules, a, b, fams(a['props'])):
            cs = lead_comment(s, a['start'])
            cmt = s[cs:a['start']].strip()
            abody = s[a['ob'] + 1:a['end'] - 1].strip()
            if not mask(abody).rstrip().endswith(';'): abody += ';'
            bbody = s[b['ob'] + 1:b['end'] - 1]
            newB = s[b['start']:b['ob'] + 1] + NL + indent_block(abody) + NL + bbody.lstrip(' \t\r\n').join(['  ', '']) if False else None
            head = NL + indent_block(abody)
            newB = s[b['start']:b['ob'] + 1] + head + (bbody if bbody.startswith(('\n', '\r\n')) else NL + '  ' + bbody.lstrip()) + '}'
            # B 앞에 A 의 설명 주석
            bs = lead_comment(s, b['start'])
            e = cut_line_end(s, a['end'])
            s = s[:cs] + s[e:bs] + ((cmt + NL) if cmt else '') + s[bs:b['start']] + newB + s[b['end']:]
            stats['down'] += 1
            return s, '아래로: ' + k[:60]
        done_pairs.add(key)
    return s, None

log = []
while True:
    s2, what = step(src)
    if not what: break
    src = s2; log.append(what)
    assert src.count('{') == src.count('}'), what

if not DRY:
    io.open(P, 'w', encoding='utf-8', newline='').write(src)
sys.stdout.reconfigure(encoding='utf-8')
print(stats)
for x in log: print('  ', x)
