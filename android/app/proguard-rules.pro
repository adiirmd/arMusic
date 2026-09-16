# The web player reaches this class by name through addJavascriptInterface,
# so R8 must not rename or strip it.
-keepclassmembers class id.my.adiirmd.armusic.MainActivity$NativeBridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class id.my.adiirmd.armusic.MainActivity$NativeBridge { *; }
