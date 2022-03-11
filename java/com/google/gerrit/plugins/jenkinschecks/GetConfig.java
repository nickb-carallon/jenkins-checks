package com.google.gerrit.plugins.jenkinschecks;

import com.google.gerrit.extensions.annotations.PluginName;
import com.google.gerrit.extensions.restapi.Response;
import com.google.gerrit.extensions.restapi.RestReadView;
import com.google.gerrit.server.config.PluginConfigFactory;
import com.google.gerrit.server.project.NoSuchProjectException;
import com.google.gerrit.server.project.ProjectResource;
import com.google.gson.annotations.SerializedName;
import com.google.inject.Inject;
import com.google.inject.Singleton;

@Singleton
public class GetConfig implements RestReadView<ProjectResource> {
    private final PluginConfigFactory config;
    private final String pluginName;

    @Inject
    GetConfig(PluginConfigFactory config, @PluginName String pluginName) {
        this.config = config;
        this.pluginName = pluginName;
    }

    @Override
    public Response<JenkinsChecksConfig> apply(ProjectResource project) throws NoSuchProjectException {
        JenkinsChecksConfig result = new JenkinsChecksConfig();
        result.instance = config.getFromGerritConfig(pluginName).getString("instance");
        result.username = config.getFromGerritConfig(pluginName).getString("username");
        result.token = config.getFromGerritConfig(pluginName).getString("token");
        result.job = config.getFromProjectConfig(project.getNameKey(), pluginName).getString("jenkins-job");
        return Response.ok(result);
    }

    static class JenkinsChecksConfig {
        @SerializedName("instance")
        String instance;

        @SerializedName("username")
        String username;

        @SerializedName("token")
        String token;

        @SerializedName("job")
        String job;
    }
}
