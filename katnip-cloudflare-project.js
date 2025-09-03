import {DeclaredError, startCommand, findNodeBin, runCommand} from "katnip";
import WORKER_STUB from "./worker-stub.js";
import fs, {promises as fsp} from "node:fs";
import path from "node:path";
import {fileURLToPath} from 'url';
import QqlDriverWrangler from "katnip/qql-wrangler-driver";
import {cloudflareGetBinding, cloudflareAddBinding, wranglerD1Create, wranglerR2Create} from "./cloudflare-util.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function createDatabaseQqlDriver(ev) {
	if (ev.env.DATABASE_URL)
		return;

    return new QqlDriverWrangler({
    	d1Binding: "DB",
        local: (ev.target.mode=="dev"),
        remote: (["prod","staging"].includes(ev.target.mode)),
        wranglerJsonPath: path.join(ev.target.cwd,"wrangler.json"),
        wranglerBin: await findNodeBin(__dirname,"wrangler"),
        wranglerEnv: ev.target.env,
        env: (ev.target.mode!="prod"?ev.target.mode:undefined)
    });
}

export async function provision(ev) {
	if (ev.target.platform!="cloudflare")
		return;

	/*if (!ev.local && !ev.remote)
		throw new DeclaredError("Need --local or --remote for cloudflare provision.");*/

	if (!await ev.isDatabaseUsed())
		return;

	await initWranglerJson(ev);

	let pkg=await ev.target.processProjectFile("package.json","json");

	let wranglerPath=path.join(ev.target.cwd,"wrangler.json");
	let wrangler=await ev.target.processProjectFile("wrangler.json","json",async wrangler=>{
		if (!cloudflareGetBinding(wrangler,"DB")) {
			cloudflareAddBinding(wrangler,"d1_databases",{
				binding: "DB",
				database_name: pkg.name,
				database_id: "undefined",
				preview_database_id: pkg.name
			});
		}

		if (await ev.isDatabaseStorageUsed()) {
			if (!cloudflareGetBinding(wrangler,"BUCKET")) {
				cloudflareAddBinding(wrangler,"r2_buckets",{
					binding: "BUCKET",
					bucket_name: "undefined",
					preview_bucket_name: pkg.name
				});
			}
		}
	});

	if (ev.target.mode=="prod") {
		if (wrangler.d1_databases) {
			for (let database of wrangler.d1_databases) {
				if (String(database.database_id)=="undefined") {
					ev.target.log("Creating D1 database: "+database.database_name);
					let databaseId=await wranglerD1Create({
						name: database.database_name,
						wranglerPath: wranglerPath,
						env: ev.target.env,
						nodeCwd: __dirname
					});

		            database.database_id=databaseId;
		            fs.writeFileSync(wranglerPath,JSON.stringify(wrangler,null,2));
				}
			}
		}

		if (wrangler.r2_buckets) {
			for (let bucket of wrangler.r2_buckets) {
				if (String(bucket.bucket_name)=="undefined") {
					console.log("Creating R2 bucket: "+wrangler.name);
					await wranglerR2Create({
						name: wrangler.name,
						wranglerPath: wranglerPath,
						env: ev.target.env,
						nodeCwd: __dirname
					});

					bucket.bucket_name=wrangler.name;
		            fs.writeFileSync(wranglerPath,JSON.stringify(wrangler,null,2));
				}
			}
		}
	}
}

async function initWranglerJson(ev) {
	let pkg=await ev.target.processProjectFile("package.json","json");
	await ev.target.processProjectFile("wrangler.json","json",async wrangler=>{
		if (!wrangler)
			wrangler={};

		if (wrangler.name && wrangler.name!=pkg.name)
			throw new DeclaredError(
				"The name field in wrangler.json is specified, and it is different from the package name. "+
				"Please set it to the same as the package name or remove it."
			);

		if (wrangler.main && wrangler.main!=".target/worker.js")
			throw new DeclaredError(
				"The main entry point in wrangler.json is manually set to something different than "+
				"expected, please remove it and it will be set automatically."
			);

		wrangler.name=pkg.name;
		wrangler.main=".target/worker.js";

		if (!wrangler.compatibility_date)
			wrangler.compatibility_date = "2025-06-04";

		if (!wrangler.assets)
			wrangler.assets={};

		if (!wrangler.assets.directory)
			wrangler.assets.directory="./public";

		return wrangler;
	});
}

export async function init(ev) {
	await initWranglerJson(ev);
}

build.priority=20;
export async function build(buildEvent) {
	let project=buildEvent.target;
	project.excludeFromRuntimeEnv("CLOUDFLARE_API_TOKEN");

	if (project.platform!="cloudflare")
		return;

	await initWranglerJson(buildEvent);

	let importStatements=[];
	let importModuleNames=[];
	for (let k in buildEvent.importModules) {
		importStatements.push(`import * as ${k} from "${buildEvent.importModules[k]}";`);
		importModuleNames.push(k);
	}

	let listenerImports=[];
	let listenerNames=[];
	let importPaths=await project.resolveEntrypoints("katnip-server-hooks",{
		conditions: ["workerd"]
	});

	//console.log("resolved entry points... ",importPaths);

	for (let [index,fn] of importPaths.entries()) {
		listenerImports.push(`import * as listener${index} from "${fn}";`);
		listenerNames.push(`listener${index}`);
	}

	let workerSource=WORKER_STUB.replace("$$WORKER_DATA$$",
		importStatements.join("\n")+"\n\n"+
		listenerImports.join("\n")+"\n\n"+
		`const workerData={\n`+
		`    importModules: {${importModuleNames.join(",")}},\n`+
		`    modules: [${listenerNames.join(",")}],\n`+
		`    env: ${JSON.stringify(buildEvent.getRuntimeEnv())},\n`+
		`};`
	);

	fs.mkdirSync(path.join(project.cwd,".target"),{recursive: true});
	fs.writeFileSync(path.join(project.cwd,".target/worker.js"),workerSource);
}

export async function dev(ev) {
	let options={
		//waitForOutput: "Ready on",
		nodeCwd: __dirname,//ev.target.cwd,
		expect: 0,
		waitForPort: ev.port
	}

	return await startCommand("wrangler",[
		"dev",
		"--no-live-reload",
		"--cwd",ev.target.cwd,
		"--port",ev.port,
		"--test-scheduled"
	],options);
}

export async function deploy(ev) {
	let project=ev.target;

	let options={
		nodeCwd: __dirname,
		expect: 0,
	}

	let wranglerOptions=[
		"deploy",
		"--cwd",project.cwd,
	];

	if (ev.target.mode!="prod")
		wranglerOptions.push("--env",ev.target.mode);

	return await runCommand("wrangler",wranglerOptions,options);
}
