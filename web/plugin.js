import { Category, LinkIcon, ResponseCode, RunStatus } from './checks';

export class JenkinsFetcher {

    constructor(plugin) {
        this.restApi = plugin.restApi();
        this.pluginName = encodeURIComponent(plugin.getPluginName());

        this.config = null;
    }

    doJenkinsFetch(job, url, method = "GET") {
        const creds = btoa(`${this.config.username}:${this.config.token}`);
        const auth = { "Authorization" : `Basic ${creds}` };
        return fetch(`${this.config.instance}/job/${this.config.job}/job/${job}/${url}`, {
            headers : auth,
            method: method
        });
    }

    convertToJenkinsJob(changeNumber, patchsetNumber) {
        const leading = String(changeNumber % 100).padStart(2, '0');
        return encodeURIComponent(`${leading}/${changeNumber}/${patchsetNumber}`);
    }

    async fetch(changeData) {
        const {changeNumber, patchsetNumber, repo} = changeData;

        // create a basic result
        const result = {
            responseCode: ResponseCode.OK
        }

        // fetch the config from Gerrit
        const config = await this.restApi.get(`/projects/${encodeURIComponent(repo)}/${this.pluginName}~config`);
        if (!config || !config.instance || !config.job) {
            console.info("Jenkins checks not configured");
            return result;
        }
        this.config = config;

        // fetch the job info from Jenkins
        const changeJob = this.convertToJenkinsJob(changeNumber, patchsetNumber);
        const jobResponse = await this.doJenkinsFetch(changeJob, "api/json?tree=name,url,buildable,inQueue,builds[building,duration,estimatedDuration,timestamp,result,number]")
        if (!jobResponse.ok) {
            // just return an empty response on an error
            return result;
        }
        const job = await jobResponse.json();

        // convert the job to a Gerrit check result
        if (job.builds.length == 0) {
            // add a single run to provide a link to the jenkins job
            result.runs = await this.buildRun(job, null);
        } else {
            // convert the builds to Gerrit check runs
            result.runs = await Promise.all(job.builds.map(async (build) => await this.buildRun(job, build), this));
        }

        return result;
    }

    async buildRun(job, build) {
        const run = {
            checkName: 'Jenkins',
            statusLink: job.url,
            labelName: 'Verified',
            actions: []
        };

        if (job.buildable) {
            const runAction = () => {
                return this.doJenkinsFetch(job.name, "build", "POST").then(response => ({
                    shouldReload: response.ok,
                    message: response.ok ? "" : "Error trying to run Jenkins job"
                })).catch(reason => ({
                    message: `Error: ${reason}`
                }));
            }

            run.actions.push(
                {
                    name: 'Run',
                    primary: true,
                    callback: runAction
                }
            );
        }

        if (build == null) {
            run.status = job.inQueue ? RunStatus.SCHEDULED : RunStatus.RUNNABLE;
        } else {
            run.attempt = build.number;
            run.status = (job.inQueue ? RunStatus.SCHEDULED : (build.building ? RunStatus.RUNNING : RunStatus.COMPLETED));
            run.startedTimestamp = new Date(build.timestamp);
            run.finishedTimestamp = new Date(build.timestamp + (build.building ? build.estimatedDuration : build.duration));
            if (build.building) {
                run.actions.push(
                    {
                        name: 'Cancel',
                        callback: (change, patchset, attempt) => {
                            return this.doJenkinsFetch(job.name, `${attempt}/stop`, "POST").then(response => ({
                                shouldReload: response.ok,
                                message: response.ok ? "" : "Error trying to cancel Jenkins build"
                            })).catch(reason => ({
                                message: `Error: ${reason}`
                        }))}
                    }
                )
            }
            run.results = await (async () => {
                if (!build.building) {
                    if (build.result == "ABORTED") {
                        return [{
                            category: Category.INFO,
                            summary: 'Build was aborted'
                        }];
                    }
                    if (build.result == "FAILURE") {
                        // collect workflow run data
                        const runResponse = await this.doJenkinsFetch(job.name, `${build.number}/wfapi/describe?fullStages=true`);
                        if (runResponse.ok) {
                            const runJson = await runResponse.json();
                            const results = this.toResults(runJson.stages);
                            if (results.length != 0) {
                                return results;
                            }
                        }
                        return [{
                            category: Category.ERROR,
                            summary: 'Build failed'
                        }];
                    }
                    if (build.result == "SUCCESS") {
                        return [{
                            category: Category.SUCCESS,
                            summery: 'Build was successfully completed'
                        }]
                    }
                }
                // for builds in progess, and those that completed successfully, return no results
                return [];
            })();
        }

        return run;
    }

    toResults(stages) {
        const toStageResults = (results, stage) => {
            const toNodeResults = (nodeResults, node) => {
                if (node.status == 'FAILED') {
                    nodeResults.push({
                        category: Category.ERROR,
                        summary: `Error in '${stage.name}/${node.name}'`,
                        message: `${node.error.message}`,
                        links: [{
                            url: `${this.config.instance}${node._links.console.href}`,
                            tooltip: 'Link to step logs',
                            primary: true,
                            icon: LinkIcon.EXTERNAL
                        }]
                    })
                }
                return nodeResults;
            }

            if (stage.status == "FAILED") {
                results = results.concat(stage.stageFlowNodes.reduce(toNodeResults, []));
            }
            return results;
        }

        return stages.reduce(toStageResults, []);
    }
}

window.Gerrit.install(plugin => {
    const fetcher = new JenkinsFetcher(plugin);
    plugin.checks().register({
        fetch: data => fetcher.fetch(data),
    })
})