package com.gbo2.sim;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.Insets;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.ValueCallback;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * GBO2 커스텀 파츠 시뮬레이터 — 오프라인 단일 HTML 을 WebView 로 감싼 래퍼.
 * 이미지는 HTML 안에 data URI 로 인라인되어 있어 저장소에 이미지 파일이 생기지 않는다
 * (→ 갤러리/미디어 스캐너에 잡히지 않음). localStorage 는 앱 전용 영역에 저장된다.
 */
public class MainActivity extends Activity {

    private WebView web;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);       // localStorage(저장 구성·즐겨찾기·기본 제외) 유지
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        // 뷰포트: 메타(width=device-width)를 존중해 기기 폭 그대로 렌더.
        // overviewMode 를 끄면 내용이 조금 넓어도 '전체 축소'로 세로 글자가 작아지지 않는다.
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(false);
        s.setSupportZoom(true);             // 사용자 핀치 확대는 허용(작게 느껴질 때)
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);

        web.setWebViewClient(new WebViewClient());   // 링크를 외부 브라우저로 넘기지 않고 내부에서 처리

        // targetSdk 35+ 는 edge-to-edge 가 강제라 내용이 상태바/네비바 뒤로 그려진다.
        // 시스템 바 인셋만큼 WebView 에 패딩을 줘서 상단(제목·툴바)이 가리지 않게 하고,
        // 패딩 영역 배경을 앱 배경색(#0f1013)으로 맞춘다.
        web.setBackgroundColor(Color.parseColor("#0f1013"));
        web.setFitsSystemWindows(false);
        web.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override
            public WindowInsets onApplyWindowInsets(View v, WindowInsets insets) {
                int top, bottom, left, right;
                if (Build.VERSION.SDK_INT >= 30) {
                    Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                    top = bars.top; bottom = bars.bottom; left = bars.left; right = bars.right;
                } else {
                    top = insets.getSystemWindowInsetTop();
                    bottom = insets.getSystemWindowInsetBottom();
                    left = insets.getSystemWindowInsetLeft();
                    right = insets.getSystemWindowInsetRight();
                }
                v.setPadding(left, top, right, bottom);
                return insets;
            }
        });

        setContentView(web);
        web.requestApplyInsets();

        web.loadUrl("file:///android_asset/index.html");
    }

    /**
     * 하드웨어 뒤로가기:
     *  - 열린 모달/드로어가 있으면 닫고(웹의 Escape 처리 재사용),
     *  - 파츠 적용(build) 화면이면 기체 선택으로,
     *  - 그 외에는 앱 종료.
     */
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
                if (value != null && value.contains("handled")) {
                    // 웹이 처리함 — 아무것도 안 함
                } else {
                    finish();
                }
            }
        });
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            onBackPressed();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }
}
