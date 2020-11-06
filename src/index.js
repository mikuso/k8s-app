const fs = require('fs');
const http = require('http');
const YAML = require('yaml');

class K8SApp {
    constructor(options) {
        if (!options) options = {};

        this.configPath = options.configPath;
        this.logger = options.logger || console.error.bind(console);
        this.probeServerPort = options.probeServerPort || 8066;
        this.maxStartupMs = options.maxStartupMs == null ? 1000*60 : options.maxStartupMs;
        this.maxShutdownMs = options.maxShutdownMs == null ? 1000*30 : options.maxShutdownMs;

        this.config = {};
        this.locals = {};
        this.boundExit = this.exit.bind(this);

        this.isReady = false;
        this.isExiting = false;
    }

    async startup() {}
    async shutdown() {}
    async probe() { return true; }

    onStartup(func) {
        this.startup = func.bind(this);
        return this;
    }

    onShutdown(func) {
        this.shutdown = func.bind(this);
        return this;
    }

    onProbe(func) {
        this.probe = func.bind(this);
        return this;
    }

    async loadConfig() {
        if (!this.configPath) {
            // nothing to load
            this.logger(`No config yaml specified`);
            return;
        }

        const configStr = await new Promise((resolve, reject) => {
            fs.readFile(this.configPath, 'utf8', (err, str) => {
                err ? reject(err) : resolve(str);
            });
        });

        this.config = YAML.parse(configStr);
    }

    async startProbeServer() {
        this.probeServer = http.createServer();
        this.probeServer.on('request', async (req, res) => {
            const probeType = req.url.substring(1);

            try {
                if (!this.isReady) {
                    throw Error(`App is still starting`);
                }

                if (this.isExiting) {
                    throw Error(`App is exiting`);
                }

                await this.probe({
                    config: this.config,
                    locals: this.locals,
                    probeType, // 'liveness' or 'readiness'
                });

            } catch (err) {
                this.logger(`Probe Failure:`, err.stack);
                res.statusCode = 500;
            }

            res.end();
        });
        await new Promise((resolve, reject) => {
            this.probeServer.listen(this.probeServerPort, err => {
                err ? reject(err) : resolve();
            });
        });
    }

    async stopProbeServer() {
        if (this.probeServer && this.probeServer.listening) {
            this.probeServer.close();
            this.probeServer = null;
        }
    }

    async exit(err) {
        try {
            if (this.isExiting) {
                return; // already exiting; we don't want to shut down twice
            }

            this.isExiting = true;
            process.off('SIGINT', this.boundExit);
            process.off('SIGTERM', this.boundExit);

            this.logger('Exiting on', err);
            if (err instanceof Error) {
                process.exitCode = 1;
            }

            await this.stopProbeServer();
            const shutdown = this.shutdown({
                config: this.config,
                locals: this.locals,
                error: err,
            });
            await Promise.race([
                shutdown,
                this.timeout(this.maxShutdownMs, `Shutdown time exceeds maxShutdownMs (${this.maxShutdownMs})`),
            ]);

        } catch (err) {
            this.logger(`Error during shutdown:`, err);
            process.exit(1);
        }
    }

    async run() {
        try {
            process.on('SIGINT', this.boundExit);
            process.on('SIGTERM', this.boundExit);

            this.isReady = false;
            await this.loadConfig();

            await this.startProbeServer();
            const startup = this.startup({
                config: this.config,
                locals: this.locals,
                exitHandler: this.boundExit,
            });
            await Promise.race([
                startup,
                this.timeout(this.maxStartupMs, `Startup time exceeds maxStartupMs (${this.maxStartupMs})`),
            ]);

            this.isReady = true;
        } catch (err) {
            this.exit(err);
        }
    }

    async timeout(ms, msg) {
        return new Promise((res, rej) => setTimeout(() => rej(msg || "Timeout", ms)));
    }
}

module.exports = function(options) {
    return new K8SApp(options);
};
