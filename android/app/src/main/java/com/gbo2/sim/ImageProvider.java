package com.gbo2.sim;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;

/**
 * 성능 카드 PNG 를 다른 앱에 넘기기 위한 최소 ContentProvider.
 *
 * 안드로이드 클립보드는 이미지를 직접 담지 못하고 content:// URI 만 받는다.
 * 보통 androidx 의 FileProvider 를 쓰지만, 이 프로젝트는 의존성이 하나도 없고
 * 오프라인에서 그대로 빌드되는 상태라 그걸 깨고 싶지 않았다. 프레임워크만으로
 * 같은 일을 하는 최소 구현을 둔다.
 *
 * 캐시 폴더(cache/share) 안의 파일만 연다 — 그 밖의 경로는 열지 않는다.
 * 복사는 파일을 남기지 않아야 하므로 Download 가 아니라 캐시에 쓴다(저장과 다른 점).
 */
public class ImageProvider extends ContentProvider {

    public static final String AUTHORITY = "com.gbo2.sim.images";

    /** 캐시 안의 공유용 폴더. 복사할 때마다 여기에 덮어쓴다. */
    public static File shareDir(android.content.Context c) {
        File d = new File(c.getCacheDir(), "share");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    public static Uri uriFor(String name) {
        return Uri.parse("content://" + AUTHORITY + "/" + Uri.encode(name));
    }

    /** URI 를 캐시 폴더 안의 실제 파일로 바꾼다. 폴더 밖을 가리키면 거절한다. */
    private File resolve(Uri uri) throws java.io.IOException {
        String name = uri.getLastPathSegment();
        if (name == null || name.contains("/") || name.contains("\\") || name.contains("..")) return null;
        File dir = shareDir(getContext());
        File f = new File(dir, name);
        // 심볼릭 링크 등으로 폴더를 벗어나는 경우까지 막는다
        if (!f.getCanonicalPath().startsWith(dir.getCanonicalPath() + File.separator)) return null;
        return f.exists() ? f : null;
    }

    @Override public boolean onCreate() { return true; }

    @Override public String getType(Uri uri) { return "image/png"; }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws java.io.FileNotFoundException {
        File f;
        try { f = resolve(uri); } catch (java.io.IOException e) { f = null; }
        if (f == null) throw new java.io.FileNotFoundException(String.valueOf(uri));
        return ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    /** 붙여넣는 쪽이 파일 이름·크기를 물어보는 경우가 있어 최소한으로 답한다. */
    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sort) {
        File f;
        try { f = resolve(uri); } catch (java.io.IOException e) { f = null; }
        if (f == null) return null;
        String[] cols = projection != null ? projection
            : new String[]{ OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE };
        MatrixCursor c = new MatrixCursor(cols);
        Object[] row = new Object[cols.length];
        for (int i = 0; i < cols.length; i++) {
            if (OpenableColumns.DISPLAY_NAME.equals(cols[i])) row[i] = f.getName();
            else if (OpenableColumns.SIZE.equals(cols[i])) row[i] = f.length();
            else row[i] = null;
        }
        c.addRow(row);
        return c;
    }

    // 읽기 전용 — 아래는 쓰지 않는다.
    @Override public Uri insert(Uri uri, ContentValues v) { return null; }
    @Override public int delete(Uri uri, String s, String[] a) { return 0; }
    @Override public int update(Uri uri, ContentValues v, String s, String[] a) { return 0; }
}
