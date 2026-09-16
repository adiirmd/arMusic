plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "id.my.adiirmd.armusic"
    compileSdk = 35

    defaultConfig {
        applicationId = "id.my.adiirmd.armusic"
        minSdk = 24
        targetSdk = 35
        // CI menetapkan keduanya dari versi rilis dan nomor run, supaya setiap
        // rilis punya versionCode yang naik. Android menolak memasang pembaruan
        // dengan versionCode yang tidak lebih besar.
        versionCode = (System.getenv("VERSION_CODE") ?: "1").toInt()
        versionName = System.getenv("VERSION_NAME") ?: "1.0.0"
        resourceConfigurations += listOf("in", "en")
    }

    /*
     * Release signing comes from environment variables so no private key ever
     * lands in the repository. CI fills them from repository secrets; a local
     * build without them falls back to an unsigned release that CI would
     * reject anyway.
     */
    signingConfigs {
        create("release") {
            val store = System.getenv("ANDROID_KEYSTORE_FILE")
            if (!store.isNullOrBlank()) {
                storeFile = file(store)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
                // v1 stays on for API 24; v2/v3 are what Play Protect looks at
                enableV1Signing = true
                enableV2Signing = true
                enableV3Signing = true
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (!System.getenv("ANDROID_KEYSTORE_FILE").isNullOrBlank()) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
        debug {
            applicationIdSuffix = ".debug"
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    dependenciesInfo {
        // Keep the dependency blob out of the APK; it is only meaningful for
        // Play-signed bundles and makes reproducible builds harder to verify.
        includeInApk = false
        includeInBundle = true
    }

    packaging {
        resources.excludes += setOf("/META-INF/{AL2.0,LGPL2.1}")
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    // MediaStyle notification + MediaSessionCompat, so the notification shows
    // real transport controls instead of a line of text.
    implementation("androidx.media:media:1.7.0")
}
