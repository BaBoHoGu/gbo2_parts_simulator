package com.gbo2.sim;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.Intent;
import android.content.ClipboardManager;
import android.content.ContentValues;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.KeyEvent;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.webkit.JavascriptInterface;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * GBO2 커스텀 파츠 시뮬레이터 — 오프라인 단일 HTML 을 WebView 로 감싼 래퍼 + 데이터 OTA.
 *
 * 앱을 고정 가상주소(APP_URL)로 띄운다 → 번들/OTA 어느 쪽 HTML 을 서빙해도 origin 이 같아
 * localStorage(저장 구성·즐겨찾기)가 보존된다. 실행 시 백그라운드로 version.json 을 확인해
 * 더 최신이면 HTML 을 내려받아 다음 실행부터 적용한다(오프라인이면 조용히 넘어간다).
 * 이미지는 HTML 안에 data URI 로 인라인돼 있어 저장소에 이미지 파일이 생기지 않는다(갤러리 무오염).
 */
public class MainActivity extends Activity {

    // 앱을 항상 이 가상주소로 로드한다(실제 네트워크 없음 — 아래 인터셉트로 로컬 서빙). origin 고정용.
    private static final String APP_HOST = "gbo2.local";
    private static final String APP_URL  = "https://gbo2.local/index.html";

    // 데이터 OTA 채널 (GitHub Release 고정 태그 'data')
    private static final String OTA_BASE    = "https://github.com/BaBoHoGu/gbo2_parts_simulator/releases/download/data";
    private static final String OTA_VERSION = OTA_BASE + "/version.json";
    private static final String OTA_HTML    = OTA_BASE + "/gbo2-simulator.html";

    private static final String PREFS = "gbo2_ota";
    private static final String KEY_DATE = "data_date";   // 현재 서빙 중인 데이터 날짜(yyyy-MM-dd)

    private static final int REQ_WRITE = 1001;
    private WebView web;
    private FrameLayout splashRoot;
    private View splashView;
    private TextView splashMsg;
    private boolean opened = false;
    // 시작 갱신과 「업데이트 확인」이 겹치지 않게 한다. 시작 다운로드가 SPLASH_MAX_MS 를
    // 넘기면 앱이 먼저 열리고, 그 사이 사용자가 버튼을 누를 수 있다 — 예전엔 두 스레드가
    // 같은 임시 파일에 써서 받은 것이 버려졌다.
    private final java.util.concurrent.atomic.AtomicBoolean updating =
        new java.util.concurrent.atomic.AtomicBoolean(false);
    /** 시작 화면을 붙들어 둘 최대 시간 — 이걸 넘기면 갱신을 못 마쳤어도 앱을 연다. */
    private static final long SPLASH_MAX_MS = 20000;
    private byte[] pendingImg;      // pre-Q 저장 권한 대기 중인 이미지
    private String pendingName;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);       // localStorage(저장 구성·즐겨찾기·기본 제외) 유지
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(false);   // 세로에서 전체 축소 렌더 방지
        s.setUseWideViewPort(true);
        s.setSupportZoom(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);

        web.setBackgroundColor(Color.parseColor("#0f1013"));
        web.setWebViewClient(new WebViewClient() {
            /**
             * 앱 밖 주소(위키·공식 사이트 등)는 기본 브라우저로 넘긴다.
             * 그냥 두면 WebView 가 앱 자리에 그 페이지를 열어 버려 돌아올 길이 마땅치 않다.
             * 우리 문서(gbo2.local)만 앱 안에서 연다.
             */
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (u == null || APP_HOST.equals(u.getHost())) return false;   // 앱 문서는 그대로
                try {
                    Intent i = new Intent(Intent.ACTION_VIEW, u);
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(i);
                } catch (Exception e) {
                    toastUi("이 링크를 열 수 있는 앱이 없습니다");
                }
                return true;   // WebView 가 따라가지 않게 한다
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (u != null && APP_HOST.equals(u.getHost())) {
                    return serveApp();   // 앱 문서는 번들 또는 OTA 파일에서 로컬 서빙
                }
                return super.shouldInterceptRequest(view, request);
            }

            // 앱 문서 로드가 실패하면(예: OTA 파일 문제) 그 파일을 버리고 번들로 복구한다.
            // 번들 asset 은 항상 정상이라 한 번 리로드로 회복되고 무한 루프가 없다.
            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame() && request.getUrl() != null
                        && APP_HOST.equals(request.getUrl().getHost()) && otaFile().exists()) {
                    otaFile().delete();
                    getSharedPreferences(PREFS, MODE_PRIVATE).edit().remove(KEY_DATE).apply();
                    view.post(() -> view.loadUrl(APP_URL));
                    return;
                }
                super.onReceivedError(view, request, error);
            }
        });

        // JS prompt/confirm/alert 를 네이티브 다이얼로그로 처리한다.
        // (WebView 는 기본적으로 이들을 무시 → 구성 저장·이름변경·삭제·공유코드 입력이 안 됨)
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onJsAlert(WebView v, String url, String msg, final JsResult r) {
                new AlertDialog.Builder(MainActivity.this).setMessage(msg)
                    .setPositiveButton("확인", (d, w) -> r.confirm())
                    .setOnCancelListener(d -> r.cancel()).show();
                return true;
            }
            @Override
            public boolean onJsConfirm(WebView v, String url, String msg, final JsResult r) {
                new AlertDialog.Builder(MainActivity.this).setMessage(msg)
                    .setPositiveButton("확인", (d, w) -> r.confirm())
                    .setNegativeButton("취소", (d, w) -> r.cancel())
                    .setOnCancelListener(d -> r.cancel()).show();
                return true;
            }
            @Override
            public boolean onJsPrompt(WebView v, String url, String msg, String def, final JsPromptResult r) {
                final EditText in = new EditText(MainActivity.this);
                if (def != null) { in.setText(def); in.setSelection(def.length()); }
                new AlertDialog.Builder(MainActivity.this).setMessage(msg).setView(in)
                    .setPositiveButton("확인", (d, w) -> r.confirm(in.getText().toString()))
                    .setNegativeButton("취소", (d, w) -> r.cancel())
                    .setOnCancelListener(d -> r.cancel()).show();
                return true;
            }
        });

        // 이미지 저장 브리지 — WebView 는 blob 다운로드가 안 되므로 base64 를 받아 Download 폴더에 쓴다.
        web.addJavascriptInterface(new Object() {
            /**
             * 앱에서 「업데이트 확인」을 눌렀을 때. 시작 시 자동 갱신이 드물게 실패하는데
             * (네트워크가 늦게 붙는 등) 그때 사용자가 직접 다시 시도할 손잡이가 필요하다.
             * 시작 때와 같은 절차를 쓰되, 이미 앱이 떠 있으므로 받은 뒤 새로고침할지 묻는다.
             */
            @JavascriptInterface
            public void checkUpdate() {
                new Thread(() -> manualUpdate()).start();
            }

            @JavascriptInterface
            public void saveImage(String data, String filename) {
                try {
                    writeImageToDownloads(decodeDataUrl(data), filename);
                } catch (Exception e) { toastUi("이미지 저장에 실패했습니다"); }
            }

            /**
             * 성능 카드를 클립보드로. WebView 는 navigator.clipboard 의 이미지 쓰기를
             * 구현하지 않아 웹 쪽 복사가 늘 실패했다(저장만 됐던 이유).
             * 클립보드는 content:// URI 만 받으므로 캐시에 쓰고 ImageProvider 로 넘긴다.
             * 저장과 달리 Download 폴더에는 남기지 않는다 — 다만 붙여넣는 쪽이 읽어 갈 수 있게
             * 캐시에는 한 장이 남는다(다음 복사 때 지난 것을 치운다).
             */
            @JavascriptInterface
            public void copyImage(String data, String filename) {
                try {
                    String name = (filename == null || filename.isEmpty()) ? "gbo2.png" : filename;
                    if (!name.toLowerCase().endsWith(".png")) name += ".png";
                    name = name.replaceAll("[\\\\/:*?\"<>|]", "_");
                    ImageProvider.clearShareDir(MainActivity.this, name);   // 지난 복사본은 치운다
                    java.io.File f = new java.io.File(ImageProvider.shareDir(MainActivity.this), name);
                    java.io.FileOutputStream os = new java.io.FileOutputStream(f);
                    os.write(decodeDataUrl(data));
                    os.close();
                    Uri uri = ImageProvider.uriFor(name);
                    ClipboardManager cm = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                    ClipData clip = ClipData.newUri(getContentResolver(), "성능 카드", uri);
                    cm.setPrimaryClip(clip);
                    toastUi("이미지를 복사했습니다 — 붙여넣기로 바로 쓸 수 있습니다");
                } catch (Exception e) { toastUi("이미지 복사에 실패했습니다"); }
            }
        }, "AndroidBridge");

        // 시작 화면 위에 앱을 올린다. 갱신을 먼저 마치고 열어야 '받아 놓고 다음 실행부터'
        // 라는 어정쩡한 상태가 없어진다(예전엔 쓰던 중에 물어봐서 작업이 초기화됐다).
        splashRoot = new FrameLayout(this);
        splashRoot.addView(web);
        splashRoot.addView(buildSplash());
        setContentView(splashRoot);

        // 시작할 때 갱신을 확인하고, 있으면 받아서 **적용한 뒤** 앱을 연다.
        // 오프라인이거나 오래 걸리면 기다리지 않고 기존 버전으로 연다(아래 감시 타이머).
        new Thread(this::startupUpdate).start();
        splashRoot.postDelayed(this::openApp, SPLASH_MAX_MS);   // 무슨 일이 있어도 이만큼은 넘기지 않는다
    }

    /** 앱 HTML 응답 — OTA 로 받은 내부 파일이 있으면 그걸, 실패하거나 없으면 번들 asset 을 서빙(폴백). */
    private WebResourceResponse serveApp() {
        File ota = otaFile();
        if (ota.exists() && ota.length() > 0) {
            try { return new WebResourceResponse("text/html", "utf-8", new FileInputStream(ota)); }
            catch (Exception ignored) { /* 아래 번들로 폴백 */ }
        }
        try { return new WebResourceResponse("text/html", "utf-8", getAssets().open("index.html")); }
        catch (Exception e) { return null; }
    }

    private File otaFile() {
        return new File(getFilesDir(), "ota_index.html");
    }

    /** 현재 서빙 데이터 날짜 — 저장된 OTA 날짜, 없으면 번들(=APK versionName=빌드날짜). */
    private String servedDate() {
        SharedPreferences p = getSharedPreferences(PREFS, MODE_PRIVATE);
        String d = p.getString(KEY_DATE, null);
        if (d != null) return d;
        try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; }
        catch (Exception e) { return ""; }
    }

    /**
     * 손으로 누른 업데이트 확인. startupUpdate 와 같은 절차지만 결과를 반드시 알려 준다
     * (시작 때는 조용히 넘어가도 되지만, 눌렀는데 아무 반응이 없으면 고장으로 보인다).
     */
    private void manualUpdate() {
        if (!updating.compareAndSet(false, true)) {
            toastUi("이미 업데이트를 확인하는 중입니다");
            return;
        }
        try {
            String vj = httpGet(OTA_VERSION, 6000, 6000);
            if (vj == null) { toastUi("연결하지 못했습니다 — 잠시 후 다시 시도하세요"); return; }
            vj = vj.trim();
            if (vj.length() > 0 && vj.charAt(0) == '\ufeff') vj = vj.substring(1);
            String remote = new JSONObject(vj).optString("date", "");
            if (remote.isEmpty()) { toastUi("업데이트 정보를 읽지 못했습니다"); return; }
            if (remote.compareTo(servedDate()) <= 0) {
                toastUi("최신입니다 (데이터 " + servedDate() + ")");
                return;
            }
            toastUi("업데이트 받는 중… " + remote);
            File tmp = new File(getFilesDir(), "ota_index.manual.tmp");
            boolean got = httpDownload(OTA_HTML, tmp, 8000, 60000);
            if (!got || tmp.length() < 100000 || !htmlLooksComplete(tmp)) {
                tmp.delete();
                toastUi("업데이트를 받지 못했습니다 — 잠시 후 다시 시도하세요");
                return;
            }
            File dst = otaFile();
            dst.delete();
            if (!tmp.renameTo(dst)) { tmp.delete(); toastUi("업데이트 적용에 실패했습니다"); return; }
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(KEY_DATE, remote).apply();
            // 이미 앱이 떠 있으므로 새로고침해야 반영된다 — 작업 중일 수 있어 물어본다.
            runOnUiThread(() -> {
                if (isFinishing() || isDestroyed()) return;
                try {
                    new AlertDialog.Builder(this)
                        .setTitle("업데이트 완료")
                        .setMessage("새 데이터(" + remote + ")를 받았습니다.\n지금 적용할까요?"
                            + "\n\n※ 작업 중인 파츠 구성은 초기화됩니다. 나중에 적용해도 다음 실행부터 반영됩니다.")
                        .setPositiveButton("지금 적용", (d, w) -> { if (web != null) web.loadUrl(APP_URL); })
                        .setNegativeButton("나중에", null)
                        .show();
                } catch (Exception e) {
                    toastUi("업데이트를 받았습니다 — 앱을 다시 켜면 적용됩니다");
                }
            });
        } catch (Exception e) {
            toastUi("업데이트를 확인하지 못했습니다");
        } finally {
            updating.set(false);
        }
    }

    /** 시작 화면 — 앱과 같은 배경색이라 열릴 때 깜빡이지 않는다. */
    private View buildSplash() {
        LinearLayout v = new LinearLayout(this);
        v.setOrientation(LinearLayout.VERTICAL);
        v.setGravity(android.view.Gravity.CENTER);
        v.setBackgroundColor(Color.parseColor("#0f1013"));
        v.setClickable(true);   // 뒤 WebView 로 터치가 새지 않게

        TextView t = new TextView(this);
        t.setText("GBO2 커스텀 파츠");
        t.setTextColor(Color.parseColor("#e8eaef"));
        t.setTextSize(20);
        t.setGravity(android.view.Gravity.CENTER);
        v.addView(t);

        splashMsg = new TextView(this);
        splashMsg.setText("최신 데이터 확인 중…");
        splashMsg.setTextColor(Color.parseColor("#8a91a0"));
        splashMsg.setTextSize(13);
        splashMsg.setGravity(android.view.Gravity.CENTER);
        splashMsg.setPadding(0, 24, 0, 0);
        v.addView(splashMsg);

        splashView = v;
        return v;
    }

    private void splashSay(final String msg) {
        runOnUiThread(() -> { if (splashMsg != null) splashMsg.setText(msg); });
    }

    /** 앱을 연다(한 번만). 갱신을 마쳤든 시간이 다 됐든 여기로 모인다. */
    private void openApp() {
        runOnUiThread(() -> {
            if (opened || isFinishing() || isDestroyed()) return;
            opened = true;
            web.loadUrl(APP_URL);   // 이 시점에 OTA 파일이 있으면 그게 서빙된다
            // 문서가 그려질 틈을 조금 주고 시작 화면을 걷는다
            splashRoot.postDelayed(() -> {
                if (splashView != null && splashRoot != null) splashRoot.removeView(splashView);
            }, 700);
        });
    }

    /**
     * 시작할 때의 갱신 절차.
     *   ① version.json(작다) 을 빠르게 확인 → 최신이면 곧바로 앱을 연다
     *   ② 새 버전이 있으면 받아서 적용한 뒤 연다. 받는 동안 진행률을 보여 준다.
     * 어느 쪽이든 실패하면 기존 버전으로 연다 — 갱신 때문에 앱을 못 쓰는 일은 없어야 한다.
     */
    private void startupUpdate() {
        if (!updating.compareAndSet(false, true)) { openApp(); return; }
        try {
            String vj = httpGet(OTA_VERSION, 4000, 4000);
            if (vj == null) { splashSay("오프라인 — 저장된 버전으로 시작합니다"); openApp(); return; }
            vj = vj.trim();
            if (vj.length() > 0 && vj.charAt(0) == '﻿') vj = vj.substring(1);
            String remote = new JSONObject(vj).optString("date", "");
            if (remote.isEmpty() || remote.compareTo(servedDate()) <= 0) { openApp(); return; }

            splashSay("업데이트 받는 중… " + remote);
            File tmp = new File(getFilesDir(), "ota_index.tmp");
            boolean got = httpDownload(OTA_HTML, tmp, 8000, 60000);
            if (!got || tmp.length() < 100000 || !htmlLooksComplete(tmp)) {
                tmp.delete();
                splashSay("업데이트를 받지 못했습니다 — 저장된 버전으로 시작합니다");
                openApp();
                return;
            }
            File dst = otaFile();
            dst.delete();
            if (tmp.renameTo(dst)) {
                getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(KEY_DATE, remote).apply();
                splashSay("업데이트 완료 — " + remote);
            } else {
                tmp.delete();
            }
            openApp();
        } catch (Exception e) {
            openApp();   // 어떤 예외에도 앱은 열려야 한다
        } finally {
            updating.set(false);
        }
    }

    private static String httpGet(String url, int connectMs, int readMs) {
        HttpURLConnection c = null;
        try {
            c = open(url, connectMs, readMs);
            if (c.getResponseCode() != 200) return null;
            java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
            copy(c.getInputStream(), bo);
            return bo.toString("utf-8");
        } catch (Exception e) {
            return null;
        } finally { if (c != null) c.disconnect(); }
    }

    private static boolean httpDownload(String url, File dst, int connectMs, int readMs) {
        HttpURLConnection c = null;
        try {
            c = open(url, connectMs, readMs);
            if (c.getResponseCode() != 200) return false;
            OutputStream out = new FileOutputStream(dst);
            copy(c.getInputStream(), out);
            out.close();
            return true;
        } catch (Exception e) {
            return false;
        } finally { if (c != null) c.disconnect(); }
    }

    /** GitHub Release 다운로드는 objects.githubusercontent.com 으로 리다이렉트되므로 수동 추적한다. */
    private static HttpURLConnection open(String url, int connectMs, int readMs) throws Exception {
        for (int i = 0; i < 5; i++) {
            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(connectMs);
            c.setReadTimeout(readMs);
            c.setInstanceFollowRedirects(false);
            c.setRequestProperty("User-Agent", "gbo2-sim-app");
            int code = c.getResponseCode();
            if (code >= 300 && code < 400) {
                String loc = c.getHeaderField("Location");
                c.disconnect();
                if (loc == null) throw new Exception("redirect without location");
                url = loc;
                continue;
            }
            return c;
        }
        throw new Exception("too many redirects");
    }

    private static void copy(InputStream in, OutputStream out) throws Exception {
        byte[] buf = new byte[16384];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        in.close();
    }

    /** 다운로드한 HTML 이 온전한지 — 파일 끝에 문서 종료 태그가 있는지로 잘림/오류 페이지를 판별. */
    private static boolean htmlLooksComplete(File f) {
        try (RandomAccessFile raf = new RandomAccessFile(f, "r")) {
            long len = raf.length();
            int n = (int) Math.min(2048, len);
            raf.seek(len - n);
            byte[] buf = new byte[n];
            raf.readFully(buf);
            String tail = new String(buf, "utf-8");
            return tail.contains("</html>") || tail.contains("</body>");
        } catch (Exception e) {
            return false;
        }
    }

    private void toastUi(final String msg) {
        runOnUiThread(() -> Toast.makeText(this, msg, Toast.LENGTH_SHORT).show());
    }

    /** PNG 바이트를 기기 Download 폴더에 저장한다(Q+ 는 MediaStore, 그 이하는 권한 후 직접 쓰기). */
    /** 「data:image/png;base64,…」 에서 바이트만 꺼낸다. */
    private static byte[] decodeDataUrl(String data) {
        String b64 = data;
        int comma = data.indexOf(',');
        if (data.startsWith("data:") && comma >= 0) b64 = data.substring(comma + 1);
        return Base64.decode(b64, Base64.DEFAULT);
    }

    private void writeImageToDownloads(byte[] bytes, String filename) {
        if (filename == null || filename.isEmpty()) filename = "gbo2.png";
        if (!filename.toLowerCase().endsWith(".png")) filename += ".png";
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            try {
                ContentValues cv = new ContentValues();
                cv.put(MediaStore.Downloads.DISPLAY_NAME, filename);
                cv.put(MediaStore.Downloads.MIME_TYPE, "image/png");
                cv.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                cv.put(MediaStore.Downloads.IS_PENDING, 1);
                Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                if (uri == null) { toastUi("이미지 저장에 실패했습니다"); return; }
                OutputStream os = getContentResolver().openOutputStream(uri);
                os.write(bytes); os.close();
                cv.clear(); cv.put(MediaStore.Downloads.IS_PENDING, 0);
                getContentResolver().update(uri, cv, null, null);
                toastUi("Download 폴더에 저장했습니다: " + filename);
            } catch (Exception e) { toastUi("이미지 저장에 실패했습니다"); }
        } else {
            if (checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                pendingImg = bytes; pendingName = filename;
                runOnUiThread(() -> requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_WRITE));
                return;
            }
            writeLegacyDownload(bytes, filename);
        }
    }

    private void writeLegacyDownload(byte[] bytes, String filename) {
        try {
            File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
            if (!dir.exists()) dir.mkdirs();
            File out = new File(dir, filename);
            FileOutputStream fos = new FileOutputStream(out);
            fos.write(bytes); fos.close();
            android.media.MediaScannerConnection.scanFile(this,
                new String[]{out.getAbsolutePath()}, new String[]{"image/png"}, null);
            toastUi("Download 폴더에 저장했습니다: " + filename);
        } catch (Exception e) { toastUi("이미지 저장에 실패했습니다"); }
    }

    @Override
    public void onRequestPermissionsResult(int req, String[] perms, int[] res) {
        if (req == REQ_WRITE) {
            if (res.length > 0 && res[0] == PackageManager.PERMISSION_GRANTED && pendingImg != null) {
                writeLegacyDownload(pendingImg, pendingName);
            } else {
                toastUi("저장 권한이 필요합니다");
            }
            pendingImg = null; pendingName = null;
        }
    }

    /** 하드웨어 뒤로가기: 모달 닫기 → 기체 선택 → 종료 (웹의 Escape 처리 재사용). */
    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        if (web == null) { super.onBackPressed(); return; }
        String js =
            "(function(){"
          + "  var sel='#pietanModal:not([hidden]),#compareModal:not([hidden]),#ownedModal:not([hidden]),"
          + "#savedModal:not([hidden]),#mskillInline:not([hidden]),#autoResultPanel:not([hidden])';"
          + "  var open=document.querySelector(sel)||document.querySelector('#autoDrawer.open')"
          + "||document.body.classList.contains('view-build');"
          + "  if(open){document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',keyCode:27,which:27,bubbles:true}));return 'handled';}"
          + "  return 'exit';"
          + "})()";
        web.evaluateJavascript(js, new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String value) {
                if (value == null || !value.contains("handled")) finish();
            }
        });
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) { onBackPressed(); return true; }
        return super.onKeyDown(keyCode, event);
    }
}
