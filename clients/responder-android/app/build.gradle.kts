import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.gradle.api.tasks.testing.Test

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

fun quoted(value: String): String = "\"" +
    value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

val apiOrigin = providers.gradleProperty("sitesourcery.apiOrigin")
    .orElse("https://sitesourcery.com/api/v1")
val providerConfigured = providers.gradleProperty("sitesourcery.providerConfigured")
    .map(String::toBooleanStrict)
    .orElse(false)

android {
    namespace = "com.sitesourcery.responder"
    compileSdk = 36
    buildToolsVersion = "36.0.0"

    defaultConfig {
        applicationId = "com.sitesourcery.responder"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        testInstrumentationRunnerArguments["clearPackageData"] = "true"

        buildConfigField("String", "API_ORIGIN", quoted(apiOrigin.get()))
        buildConfigField("boolean", "PROVIDER_CONFIGURED", providerConfigured.get().toString())
        buildConfigField(
            "String",
            "FIREBASE_APPLICATION_ID",
            quoted(providers.gradleProperty("sitesourcery.firebaseApplicationId").orElse("").get())
        )
        buildConfigField(
            "String",
            "FIREBASE_API_KEY",
            quoted(providers.gradleProperty("sitesourcery.firebaseApiKey").orElse("").get())
        )
        buildConfigField(
            "String",
            "FIREBASE_PROJECT_ID",
            quoted(providers.gradleProperty("sitesourcery.firebaseProjectId").orElse("").get())
        )
        buildConfigField(
            "String",
            "FIREBASE_SENDER_ID",
            quoted(providers.gradleProperty("sitesourcery.firebaseSenderId").orElse("").get())
        )
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-held"
            isDebuggable = true
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            signingConfig = null
        }
    }

    buildFeatures {
        buildConfig = true
        compose = true
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlin {
        compilerOptions {
            jvmTarget.set(JvmTarget.JVM_17)
            allWarningsAsErrors.set(true)
            freeCompilerArgs.add("-Xannotation-default-target=param-property")
        }
    }
    packaging {
        resources.excludes += setOf(
            "/META-INF/{AL2.0,LGPL2.1}",
            "META-INF/DEPENDENCIES",
            "META-INF/LICENSE*",
            "META-INF/NOTICE*"
        )
    }
    testOptions {
        execution = "ANDROIDX_TEST_ORCHESTRATOR"
        unitTests.isIncludeAndroidResources = false
    }
    lint {
        abortOnError = true
        checkDependencies = true
        warningsAsErrors = true
        // API 36 is the deliberately tested release target for this cohort;
        // Gradle 9.5.0 is the exact AGP 9.3.1 compatibility pin.
        disable += setOf(
            "AndroidGradlePluginVersion",
            "GradleDependency",
            "OldTargetApi",
        )
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.activity:activity-compose:1.12.4")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.10.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.10.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.10.0")

    implementation(platform("androidx.compose:compose-bom:2026.06.00"))
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.foundation:foundation")

    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.11.0")

    implementation(platform("com.google.firebase:firebase-bom:34.17.0"))
    implementation("com.google.firebase:firebase-messaging")
    implementation("com.twilio:voice-android:6.10.4")
    implementation("androidx.core:core-telecom:1.0.1")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.11.0")

    androidTestImplementation(platform("androidx.compose:compose-bom:2026.06.00"))
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.7.0")
    androidTestUtil("androidx.test:orchestrator:1.6.1")
}

fun registerManifestAuthorityVerification(variant: String, applicationId: String) =
    tasks.register("verify${variant.replaceFirstChar(Char::uppercaseChar)}ManifestAuthority") {
    val taskVariant = variant.replaceFirstChar(Char::uppercaseChar)
    val mergedManifest = layout.buildDirectory.file(
        "intermediates/merged_manifests/$variant/process${taskVariant}Manifest/AndroidManifest.xml"
    )
    group = "verification"
    description = "Fails closed if the $variant merged manifest gains unreviewed authority."
    dependsOn("process${taskVariant}Manifest")
    inputs.file(mergedManifest)

    doLast {
        val androidNamespace = "http://schemas.android.com/apk/res/android"
        val document = javax.xml.parsers.DocumentBuilderFactory.newInstance().apply {
            isNamespaceAware = true
        }.newDocumentBuilder().parse(mergedManifest.get().asFile)
        val manifest = document.documentElement
        val permissions = manifest.getElementsByTagName("uses-permission").let { nodes ->
            (0 until nodes.length).associate { index ->
                val element = nodes.item(index) as org.w3c.dom.Element
                element.getAttributeNS(androidNamespace, "name") to
                    element.getAttributeNS(androidNamespace, "maxSdkVersion")
                        .takeIf { it.isNotEmpty() }
            }.also { check(it.size == nodes.length) { "Duplicate permission authority found." } }
        }
        val expectedPermissions = mapOf(
            "android.permission.ACCESS_NETWORK_STATE" to null,
            "android.permission.ACCESS_WIFI_STATE" to null,
            "android.permission.BLUETOOTH" to "30",
            "android.permission.BLUETOOTH_ADMIN" to "30",
            "android.permission.BLUETOOTH_CONNECT" to null,
            "android.permission.FOREGROUND_SERVICE" to null,
            "android.permission.FOREGROUND_SERVICE_MICROPHONE" to null,
            "android.permission.FOREGROUND_SERVICE_PHONE_CALL" to null,
            "android.permission.INTERNET" to null,
            "android.permission.MANAGE_OWN_CALLS" to null,
            "android.permission.MODIFY_AUDIO_SETTINGS" to null,
            "android.permission.POST_NOTIFICATIONS" to null,
            "android.permission.RECORD_AUDIO" to null,
            "android.permission.WAKE_LOCK" to null,
            "com.google.android.c2dm.permission.RECEIVE" to null,
            "$applicationId.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION" to null,
        )
        check(permissions == expectedPermissions) {
            "$variant permission authority drifted. Actual=$permissions"
        }

        val declaredPermissions = manifest.getElementsByTagName("permission").let { nodes ->
            (0 until nodes.length).map { index ->
                val element = nodes.item(index) as org.w3c.dom.Element
                element.getAttributeNS(androidNamespace, "name") to
                    element.getAttributeNS(androidNamespace, "protectionLevel")
            }
        }
        check(declaredPermissions == listOf(
            "$applicationId.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION" to "signature"
        )) { "$variant declared-permission authority drifted. Actual=$declaredPermissions" }

        val application = manifest.getElementsByTagName("application").item(0) as org.w3c.dom.Element
        check(application.getAttributeNS(androidNamespace, "allowBackup") == "false")
        check(application.getAttributeNS(androidNamespace, "usesCleartextTraffic") == "false")

        val metadata = application.getElementsByTagName("meta-data").let { nodes ->
            (0 until nodes.length).associate { index ->
                val element = nodes.item(index) as org.w3c.dom.Element
                element.getAttributeNS(androidNamespace, "name") to
                    element.getAttributeNS(androidNamespace, "value")
            }
        }
        check(metadata["firebase_messaging_auto_init_enabled"] == "false")
        check(metadata["firebase_analytics_collection_enabled"] == "false")

        val exported = listOf("activity", "service", "receiver", "provider").flatMap { tag ->
            application.getElementsByTagName(tag).let { nodes ->
                (0 until nodes.length).mapNotNull { index ->
                    val element = nodes.item(index) as org.w3c.dom.Element
                    if (element.getAttributeNS(androidNamespace, "exported") != "true") null
                    else listOf(
                        tag,
                        element.getAttributeNS(androidNamespace, "name"),
                        element.getAttributeNS(androidNamespace, "permission"),
                    ).joinToString(":")
                }
            }
        }.toSet()
        val expectedExported = setOf(
            "activity:com.sitesourcery.responder.MainActivity:",
            "receiver:androidx.core.telecom.internal.MuteStateReceiver:",
            "receiver:androidx.profileinstaller.ProfileInstallReceiver:android.permission.DUMP",
            "receiver:com.google.firebase.iid.FirebaseInstanceIdReceiver:" +
                "com.google.android.c2dm.permission.SEND",
            "service:androidx.core.telecom.internal.JetpackConnectionService:" +
                "android.permission.BIND_TELECOM_CONNECTION_SERVICE",
        )
        check(exported == expectedExported) {
            "$variant exported-component authority drifted. Added=${exported - expectedExported}; " +
                "removed=${expectedExported - exported}"
        }
    }
}

val verifyDebugManifestAuthority = registerManifestAuthorityVerification(
    "debug",
    "com.sitesourcery.responder.debug",
)
val verifyReleaseManifestAuthority = registerManifestAuthorityVerification(
    "release",
    "com.sitesourcery.responder",
)

tasks.matching { it.name == "assembleDebug" }.configureEach {
    dependsOn(verifyDebugManifestAuthority)
}
tasks.matching { it.name == "assembleRelease" }.configureEach {
    dependsOn(verifyReleaseManifestAuthority)
}

// The repository's HTML validator owns product HTML. Keep Gradle's generated
// unit-test HTML out of that namespace while retaining the machine-readable
// XML result used by the release proof.
tasks.withType<Test>().configureEach {
    reports.html.required.set(false)
}
