load("//tools/bzl:plugin.bzl", "gerrit_plugin")

package_group(
    name = "visibility",
    packages = ["//plugins/jenkins-checks/..."],
)

package(default_visibility = [":visibility"])

gerrit_plugin(
    name = "jenkins-checks",
    srcs = glob(["java/com/google/gerrit/plugins/jenkinschecks/**/*.java"]),
    manifest_entries = [
        "Gerrit-PluginName: jenkins-checks",
        "Gerrit-Module: com.google.gerrit.plugins.jenkinschecks.Module"
    ],
    resource_jars = ["//plugins/jenkins-checks/web:jenkins-checks"]
)