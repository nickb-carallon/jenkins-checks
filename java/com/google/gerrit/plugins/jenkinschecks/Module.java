package com.google.gerrit.plugins.jenkinschecks;

import static com.google.gerrit.server.project.ProjectResource.PROJECT_KIND;

import com.google.gerrit.extensions.annotations.Exports;
import com.google.gerrit.extensions.registration.DynamicSet;
import com.google.gerrit.extensions.restapi.RestApiModule;
import com.google.gerrit.extensions.webui.JavaScriptPlugin;
import com.google.gerrit.extensions.webui.WebUiPlugin;
import com.google.gerrit.server.config.ProjectConfigEntry;

public class Module extends RestApiModule {
    @Override
    protected void configure() {
        DynamicSet.bind(binder(), WebUiPlugin.class).toInstance(new JavaScriptPlugin("jenkins-checks.js"));

        bind(ProjectConfigEntry.class)
            .annotatedWith(Exports.named("jenkins-job"))
            .toInstance(new ProjectConfigEntry("Jenkins Verify Job", "", false, "The name of the multi-branch job that performs verifies for this project."));

        get(PROJECT_KIND, "config").to(GetConfig.class);
    }
}