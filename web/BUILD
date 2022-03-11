load("//tools/bzl:js.bzl", "gerrit_js_bundle")

package_group(
    name = "visibility",
    packages = ["//plugins/jenkins-checks/..."],
)

package(default_visibility = [":visibility"])

gerrit_js_bundle(
    name = "jenkins-checks",
    entry_point = "plugin.js",
    srcs = glob(["**/*.js"])
)