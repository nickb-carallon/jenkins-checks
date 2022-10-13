import { Category, LinkIcon, ResponseCode, RunStatus } from './checks';

export class JenkinsFetcher {

    constructor(plugin) {
        this.restApi = plugin.restApi();
        this.pluginName = encodeURIComponent(plugin.getPluginName());

        this.config = null;
    }

    makeJenkinsUrl(job, url) {
        return `${this.config.instance}/job/${this.config.job}/job/${job}/${url}`;
    }

    doJenkinsFetch(job, url, method = "GET") {
        const creds = btoa(`${this.config.username}:${this.config.token}`);
        const auth = { "Authorization" : `Basic ${creds}` };
        return fetch(this.makeJenkinsUrl(job, url), {
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
        const jobResponse = await this.doJenkinsFetch(changeJob, "api/json?tree=name,url,buildable,inQueue,builds[building,duration,estimatedDuration,timestamp,result,number],lastBuild[number]")
        if (!jobResponse.ok) {
            // just return an empty response on an error
            return result;
        }
        const job = await jobResponse.json();

        // convert the job to a Gerrit check result
        result.runs = await Promise.all(
            (job.builds.length == 0) ?
                // add a single run to provide a link to the jenkins job
                [ this.buildRun(changeNumber, patchsetNumber, job, null) ] :
                // convert the builds to Gerrit check runs
                job.builds.map((build) => this.buildRun(changeNumber, patchsetNumber, job, build), this)
        );

        if (job.lastBuild) {
            // now check warnings plugin
            let warningResults = await this.buildWarnings(changeNumber, patchsetNumber, job);
            // and test results
            let testResults = await this.buildTestResults(changeNumber, patchsetNumber, job);

            result.runs.push(...warningResults, ...testResults);
        }

        return result;
    }

    async buildRun(changeNumber, patchsetNumber, job, build) {
        const run = {
            change: changeNumber,
            patchset: patchsetNumber,
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
                            summary: 'Build completed successfully'
                        }]
                    }
                }
                // for builds in progess return no results
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

    async buildWarnings(changeNumber, patchsetNumber, job) {

        const toolsResult = await this.doJenkinsFetch(job.name, `${job.lastBuild.number}/warnings-ng/api/json?tree=tools[id,name,size,latestUrl]`);
        if (!toolsResult.ok) {
            return [];
        }

        const toolsInfo = await toolsResult.json();

        // use standard for loop as using awaits
        let runs = [];
        for (const tool of toolsInfo.tools) {
            if (tool.size == 0) {
                continue;
            }

            const toolResult = await this.doJenkinsFetch(job.name, `${job.lastBuild.number}/${tool.id}/all/api/json?tree=issues[severity,message,toString,fileName,lineStart,columnStart,lineEnd,columnEnd]`);
            if (!toolResult.ok) {
                continue;
            }

            const warnings = await toolResult.json();
            runs.push({
                change: changeNumber,
                patchset: patchsetNumber,
                checkName: tool.name,
                status: RunStatus.COMPLETED,
                statusLink: tool.latestUrl,
                actions: [],
                results: warnings.issues.map(issue => {
                    return {
                        category: (issue.severity == "ERROR") ? Category.ERROR : Category.WARNING,
                        summary: issue.message,
                        message: issue.toString,
                        codePointers: [{
                            path: issue.fileName,
                            range: {
                                start_line: issue.lineStart,
                                start_character: issue.columnStart - 1,
                                end_line: issue.lineEnd,
                                end_character: issue.columnEnd
                            }
                        }]
                    };
                })
            });
        }

        return runs;
    }

    async buildTestResults(changeNumber, patchsetNumber, job) {

        const testResult = await this.doJenkinsFetch(job.name, `${job.lastBuild.number}/testReport/api/json?tree=suites[cases[className,name,status,errorDetails]]`);
        if (!testResult.ok) {
            return [];
        }

        const testReport = await testResult.json();

        return [{
            change: changeNumber,
            patchset: patchsetNumber,
            checkName: "Tests",
            status: RunStatus.COMPLETED,
            statusLink: this.makeJenkinsUrl(job.name, `${job.lastBuild.number}/testReport`),
            actions: [],
            results: testReport.suites.flatMap(suite => {
                return suite.cases.filter(testCase => {
                    return (testCase.status == "FAILED")
                }).map(testCase => {
                    return {
                        category: Category.ERROR,
                        summary: `${testCase.className}.${testCase.name} test failed`,
                        message: (testCase.status == "FAILED") ? testCase.errorDetails : null
                    };
                });
            })
        }];
    }

}

window.Gerrit.install(plugin => {
    const fetcher = new JenkinsFetcher(plugin);
    plugin.checks().register({
        fetch: data => fetcher.fetch(data),
    })
})