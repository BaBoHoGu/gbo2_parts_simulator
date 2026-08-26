package com.gbo2.sim;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
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
            @JavascriptInterface
            public void saveImage(String data, String filename) {
                try {
                    String b64 = data;
                    int comma = data.indexOf(',');
                    if (data.startsWith("data:") && comma >= 0) b64 = data.substring(comma + 1);
                    writeImageToDownloads(Base64.decode(b64, Base64.DEFAULT), filename);
                } catch (Exception e) { toastUi("이미지 저장에 실패했습니다"); }
            }
        }, "AndroidBridge");

        setContentView(web);
        web.loadUrl(APP_URL);

        // 백그라운드로 최신 데이터 확인·수신 (실패/오프라인이면 조용히 무시)
        new Thread(this::checkOta).start();
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

    /** version.json 을 확인해 더 최신이면 HTML 을 받아 다음 실행부터 적용한다. */
    private void checkOta() {
        try {
            String vj = httpGet(OTA_VERSION, 6000, 6000);
            if (vj == null) return;
            vj = vj.trim();
            if (vj.length() > 0 && vj.charAt(0) == '﻿') vj = vj.substring(1);   // UTF-8 BOM 방어
            String remote = new JSONObject(vj).optString("date", "");
            if (remote.isEmpty()) return;
            // yyyy-MM-dd 는 사전식 비교가 곧 날짜 비교
            if (remote.compareTo(servedDate()) <= 0) return;   // 이미 최신

            File tmp = new File(getFilesDir(), "ota_index.tmp");
            if (!httpDownload(OTA_HTML, tmp, 8000, 60000)) { tmp.delete(); return; }
            // 무결성: 잘린 업로드/오류 페이지를 걸러 낸다 — 최소 크기 + 문서 끝 태그 확인.
            // (통과한 것만 교체하므로, 손상본이 저장돼 앱이 깨진 채 남는 일이 없다.)
            if (tmp.length() < 100000 || !htmlLooksComplete(tmp)) { tmp.delete(); return; }

            File dst = otaFile();
            dst.delete();
            if (tmp.renameTo(dst)) {
                getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(KEY_DATE, remote).apply();
                // 받아만 두면 사용자는 새 버전이 온 줄 모른 채 다음 실행까지 옛 화면을 쓴다
                // (실제로 "고쳤다는데 그대로다" 문의로 이어졌다). 물어보고 바로 적용한다.
                promptApplyOta(remote);
            } else {
                tmp.delete();
            }
        } catch (Exception ignored) {
            // 오프라인·네트워크 오류 등은 조용히 무시 (앱은 기존 데이터로 정상 동작)
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

    /** OTA 를 받았을 때 바로 적용할지 묻는다 — 「지금 적용」이면 새로고침해 그 자리에서 새 버전이 된다.
     *  (거절해도 다음 실행부터는 새 버전이 서빙되므로 어느 쪽이든 옛 버전에 갇히지 않는다) */
    private void promptApplyOta(final String date) {
        runOnUiThread(() -> {
            if (isFinishing() || isDestroyed()) return;
            try {
                new AlertDialog.Builder(this)
                    .setTitle("새 버전 준비 완료")
                    .setMessage("업데이트(" + date + ")를 받았습니다.
지금 적용할까요?

※ 작업 중인 파츠 구성은 초기화됩니다.")
                    .setPositiveButton("지금 적용", (d, w) -> { if (web != null) web.loadUrl(APP_URL); })
                    .setNegativeButton("나중에", null)
                    .setCancelable(true)
                    .show();
            } catch (Exception e) {
                toastUi("새 버전을 받았습니다 — 앱을 완전히 종료 후 다시 켜 주세요");
            }
        });
    }

    private void toastUi(final String msg) {
        runOnUiThread(() -> Toast.makeText(this, msg, Toast.LENGTH_SHORT).show());
    }

    /** PNG 바이트를 기기 Download 폴더에 저장한다(Q+ 는 MediaStore, 그 이하는 권한 후 직접 쓰기). */
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
