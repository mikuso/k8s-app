# A wrapper for Kubernetes app deployment

See sample k8s and skaffold yamls in `samples/`, and refer to example usage below.


## Example Usage

```js
const App = require('@flamescape/k8s-app');

App({configPath: process.env.CONFIG_PATH || './conf/dev.yaml'})
    .onStartup(async function({config, locals, exitHandler}) {
        // create database connection pool
        locals.db = await mysql.createPool(config.database);
        locals.db.on('error', exitHandler); // errors re-route to the exitHandler for graceful shutdown

        // create express webserver
        locals.app = express();
        const port = process.env.PORT || 80;
        locals.httpServer = locals.app.listen(port);

        console.log('Started');
    })
    .onShutdown(async function({config, locals, error}) {
        // close & dispose of resources in reverse order
        if (locals.httpServer) {
            console.log('Closing web service');
            locals.httpServer.close();
        }
        if (locals.db) {
            console.log('Closing DB connection');
            await locals.db.end();
        }
        console.log('Done');
    })
    .onProbe(async function({config, locals, probeType}){
        // probe callback should always throw on failure.
        await locals.db.query('SELECT 1');
    })
    .run();
```
