#!/bin/bash
# android/build_apk.sh - Build dev-sidecar-android APK
# Usage: bash build_apk.sh [--skip-sdk]

set -e

ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-F:/android-sdk}"
JAVA_HOME="${JAVA_HOME:-F:/jdk-21}"
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="$PROJECT_DIR/build-android"
APK_OUTPUT="$BUILD_DIR/app/build/outputs/apk/debug/app-debug.apk"

echo "=== dev-sidecar-android APK Builder ==="
echo "Android SDK: $ANDROID_SDK_ROOT"
echo "Java Home:   $JAVA_HOME"
echo ""

# Step 1: Check/Install Java
if [ ! -d "$JAVA_HOME" ]; then
  echo "[1/6] Installing JDK 21..."
  mkdir -p "$JAVA_HOME"
  # Try Eclipse Temurin (Adoptium) - more reliable
  curl -L "https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.2%2B13/OpenJDK21U-jdk_x64_windows_hotspot_21.0.2_13.zip" \
    -o /tmp/jdk21.zip 2>/dev/null || \
  curl -L "https://download.java.net/java/GA/jdk21.0.2/f2283984656d49d69e91c55847602767/13/GPL/openjdk-21.0.2_windows-x64_bin.zip" \
    -o /tmp/jdk21.zip
  unzip -q /tmp/jdk21.zip -d /tmp/jdk21_extract
  mv /tmp/jdk21_extract/* "$JAVA_HOME/"
  rm -rf /tmp/jdk21.zip /tmp/jdk21_extract
  echo "  JDK installed to $JAVA_HOME"
else
  echo "[1/6] JDK found at $JAVA_HOME (skipped)"
fi

export JAVA_HOME
export PATH="$JAVA_HOME/bin:$PATH"

# Step 2: Setup Android SDK
if [ ! -f "$ANDROID_SDK_ROOT/cmdline-tools/latest/bin/sdkmanager.bat" ]; then
  echo "[2/6] Downloading Android cmdline-tools..."
  mkdir -p "$ANDROID_SDK_ROOT/cmdline-tools"
  curl -L "https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip" \
    -o /tmp/cmdline-tools.zip
  unzip -q /tmp/cmdline-tools.zip -d /tmp/cmdline-tools
  mkdir -p "$ANDROID_SDK_ROOT/cmdline-tools/latest"
  mv /tmp/cmdline-tools/cmdline-tools/* "$ANDROID_SDK_ROOT/cmdline-tools/latest/"
  rm -rf /tmp/cmdline-tools.zip /tmp/cmdline-tools
  echo "  Cmdline-tools installed"
else
  echo "[2/6] Android cmdline-tools found (skipped)"
fi

export ANDROID_SDK_ROOT
export PATH="$ANDROID_SDK_ROOT/cmdline-tools/latest/bin:$PATH"
export ANDROID_HOME="$ANDROID_SDK_ROOT"

# Step 3: Install SDK components
echo "[3/6] Installing Android SDK components (this may take a while)..."
yes | sdkmanager.bat --licenses 2>/dev/null || true
sdkmanager.bat "platform-tools" "platforms;android-34" "build-tools;34.0.0" "extras;android;m2repository" 2>&1 | grep -v "^[Done\|Installing\|\s*$\]"

# Step 4: Create Android project
echo "[4/6] Creating Android project structure..."
mkdir -p "$BUILD_DIR"

# Create build.gradle (Project)
cat > "$BUILD_DIR/build.gradle" << 'GRADLE_EOF'
// Project build.gradle
buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath 'com.android.tools.build:gradle:8.2.0'
    }
}
allprojects {
    repositories {
        google()
        mavenCentral()
    }
}
GRADLE_EOF

# Create settings.gradle
cat > "$BUILD_DIR/settings.gradle" << 'GRADLE_EOF'
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "dev-sidecar-android"
include ':app'
GRADLE_EOF

# Create app/
mkdir -p "$BUILD_DIR/app/src/main/java/com/example/devsidecar"
mkdir -p "$BUILD_DIR/app/src/main/res/layout"
mkdir -p "$BUILD_DIR/app/src/main/res/values"
mkdir -p "$BUILD_DIR/app/src/main/assets/nodejs"

# Create app/build.gradle
cat > "$BUILD_DIR/app/build.gradle" << 'GRADLE_EOF'
plugins {
    id 'com.android.application'
}

android {
    namespace "com.example.devsidecar"
    compileSdk 34

    defaultConfig {
        applicationId "com.example.devsidecar"
        minSdk 24
        targetSdk 34
        versionCode 1
        versionName "1.0.0"
    }

    buildTypes {
        debug {
            minifyEnabled false
        }
        release {
            minifyEnabled false
        }
    }

    packagingOptions {
        resources {
            excludes += ['META-INF/DEPENDENCIES', 'META-INF/LICENSE', 'META-INF/NOTICE']
        }
    }
}

dependencies {
    implementation 'androidx.appcompat:appcompat:1.6.1'
    implementation 'com.google.android.material:material:1.10.0'
}
GRADLE_EOF

# Create AndroidManifest.xml
cat > "$BUILD_DIR/app/src/main/AndroidManifest.xml" << 'XML_EOF'
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    android:versionCode="1"
    android:versionName="1.0.0" >
    
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />
    <uses-permission android:name="android.permission.CHANGE_WIFI_STATE" />
    <uses-permission android:name="android.permission.WRITE_SETTINGS" />
    <uses-permission android:name="android.permission.MANAGE_EXTERNAL_STORAGE" />
    
    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:theme="@style/Theme.DevSidecar" >
        
        <activity
            android:name=".MainActivity"
            android:exported="true" >
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
        
        <service android:name=".ProxyService" android:enabled="true" android:exported="false" />
        
    </application>
</manifest>
XML_EOF

# Copy Node.js proxy files to assets
echo "  Copying Node.js proxy to assets..."
cp "$PROJECT_DIR/src/proxy.js" "$BUILD_DIR/app/src/main/assets/nodejs/"
cp "$PROJECT_DIR/package.json" "$BUILD_DIR/app/src/main/assets/nodejs/"
cp "$PROJECT_DIR/test_mitm.js" "$BUILD_DIR/app/src/main/assets/nodejs/"

# Create MainActivity.java
cat > "$BUILD_DIR/app/src/main/java/com/example/devsidecar/MainActivity.java" << 'JAVA_EOF'
package com.example.devsidecar;

import android.os.Bundle;
import android.widget.Button;
import android.widget.TextView;
import android.widget.Switch;
import androidx.appcompat.app.AppCompatActivity;

public class MainActivity extends AppCompatActivity {
    private TextView statusText;
    private Switch proxySwitch;
    private boolean isRunning = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        statusText = findViewById(R.id.status_text);
        proxySwitch = findViewById(R.id.proxy_switch);
        Button startBtn = findViewById(R.id.start_btn);
        Button stopBtn = findViewById(R.id.stop_btn);

        startBtn.setOnClickListener(v -> startProxy());
        stopBtn.setOnClickListener(v -> stopProxy());
    }

    private void startProxy() {
        statusText.setText("Starting proxy...");
        // TODO: Start Node.js process
        isRunning = true;
        statusText.setText("Proxy running on port 7890");
    }

    private void stopProxy() {
        // TODO: Stop Node.js process
        isRunning = false;
        statusText.setText("Proxy stopped");
    }
}
JAVA_EOF

# Create layout
cat > "$BUILD_DIR/app/src/main/res/layout/activity_main.xml" << 'XML_EOF'
<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical"
    android:padding="16dp" >

    <TextView
        android:id="@+id/title_text"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:text="Dev-Sidecar Android"
        android:textSize="24sp"
        android:textStyle="bold"
        android:gravity="center"
        android:layout_marginBottom="24dp" />

    <TextView
        android:id="@+id/status_text"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:text="Proxy stopped"
        android:textSize="18sp"
        android:gravity="center"
        android:layout_marginBottom="24dp" />

    <Button
        android:id="@+id/start_btn"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:text="Start Proxy"
        android:layout_marginBottom="12dp" />

    <Button
        android:id="@+id/stop_btn"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:text="Stop Proxy"
        android:layout_marginBottom="24dp" />

    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:orientation="horizontal" >
        <TextView
            android:layout_width="0dp"
            android:layout_height="wrap_content"
            android:layout_weight="1"
            android:text="MITM Mode" />
        <Switch
            android:id="@+id/mitm_switch"
            android:layout_width="wrap_content"
            android:layout_height="wrap_content" />
    </LinearLayout>

</LinearLayout>
XML_EOF

# Create strings.xml
cat > "$BUILD_DIR/app/src/main/res/values/strings.xml" << 'XML_EOF'
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">Dev-Sidecar</string>
</resources>
XML_EOF

# Create themes.xml
cat > "$BUILD_DIR/app/src/main/res/values/themes.xml" << 'XML_EOF'
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="Theme.DevSidecar" parent="Theme.MaterialComponents.Light.NoActionBar" />
</resources>
XML_EOF

echo "  Project structure created at $BUILD_DIR"

# Step 5: Build APK
echo "[5/6] Building APK (debug)..."
cd "$BUILD_DIR"

# Create local.properties
echo "sdk.dir=$ANDROID_SDK_ROOT" > local.properties
echo "flutter.sdk=" >> local.properties

# Download Gradle wrapper if not exists
if [ ! -f "gradlew.bat" ]; then
  echo "  Downloading Gradle wrapper..."
  mkdir -p gradle/wrapper
  curl -L "https://services.gradle.org/distributions/gradle-8.2-bin.zip" -o /tmp/gradle.zip
  unzip -q /tmp/gradle.zip -d /tmp/gradle
  cp /tmp/gradle/gradle-8.2/bin/gradlew "$BUILD_DIR/"
  cp /tmp/gradle/gradle-8.2/lib/* "$BUILD_DIR/gradle/wrapper/" 2>/dev/null || true
  # Use simpler approach: just use gradle from PATH or download wrapper properly
  # For now, create a simple gradlew.bat
  cat > gradlew.bat << 'BAT_EOF'
@echo off
set DIR=%~dp0
java -jar "%DIR%gradle/wrapper/gradle-wrapper.jar" %*
BAT_EOF
  # Download actual wrapper jar
  curl -L "https://github.com/gradle/gradle/raw/v8.2.0/gradle/wrapper/gradle-wrapper.jar" \
    -o "gradle/wrapper/gradle-wrapper.jar"
  rm -rf /tmp/gradle /tmp/gradle.zip
fi

# Try building with Gradle
echo "  Running gradle assembleDebug..."
./gradlew.bat assembleDebug 2>&1 | tee build.log

# Step 6: Check output
echo "[6/6] Checking APK..."
if [ -f "$APK_OUTPUT" ]; then
  echo ""
  echo "========================================="
  echo "  APK BUILT SUCCESSFULLY!"
  echo "  Location: $APK_OUTPUT"
  echo "  Size: $(du -h "$APK_OUTPUT" | cut -f1)"
  echo "========================================="
  cp "$APK_OUTPUT" "$PROJECT_DIR/dev-sidecar-android-debug.apk"
  echo "  Copied to: $PROJECT_DIR/dev-sidecar-android-debug.apk"
else
  echo "  APK not found, checking build log..."
  tail -50 "$BUILD_DIR/build.log" 2>/dev/null || echo "  No build log found"
  echo ""
  echo "  Trying alternative build method..."
fi

echo ""
echo "Build directory: $BUILD_DIR"
echo "To rebuild: bash build_apk.sh"
