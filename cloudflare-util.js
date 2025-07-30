import {runCommand, DeclaredError, extractJsonObject} from "katnip";

export async function wranglerD1Create({name, env, wranglerPath, nodeCwd}) {
    let wranglerOptions=[
        "--config",wranglerPath,
        "d1","create",name,
    ];

    let wranglerOut=await runCommand("wrangler",wranglerOptions,{
        captureOutput: true,
        env: env,
        nodeCwd: nodeCwd,
        expect: 0
    });

    let info=JSON.parse(extractJsonObject(wranglerOut));
    if (!info.d1_databases[0].database_id)
        throw new Error("Unable to parse wrangler output");

    return info.d1_databases[0].database_id;
}

export async function wranglerR2Create({name, env, wranglerPath, nodeCwd}) {
    let wranglerOptions=[
        "--config",wranglerPath,
        "r2","bucket","create",name,
    ];

    //console.log(wranglerOptions);

    let wranglerOut=await runCommand("wrangler",wranglerOptions,{
        captureOutput: true,
        env: env,
        nodeCwd: nodeCwd,
        expect: 0
    });

    let info=JSON.parse(extractJsonObject(wranglerOut));
    if (!info.r2_buckets[0].bucket_name)
        throw new Error("Unable to parse wrangler output");
}

export function cloudflareGetBinding(wranglerJson, bindingName) {
    const d1 = wranglerJson.d1_databases || [];
    for (const entry of d1) {
        if (entry.binding === bindingName) {
            return entry;
        }
    }

    const r2 = wranglerJson.r2_buckets || [];
    for (const entry of r2) {
        if (entry.binding === bindingName) {
            return entry;
        }
    }

    return undefined;
}

export function cloudflareAddBinding(wranglerJson, type, spec) {
    if (!["d1_databases", "r2_buckets"].includes(type)) {
        throw new Error(`Unsupported binding type: ${type}`);
    }

    if (!wranglerJson[type]) {
        wranglerJson[type] = [];
    }

    const arr = wranglerJson[type];
    const existingIndex = arr.findIndex(entry => entry.binding === spec.binding);

    if (existingIndex !== -1) {
        arr[existingIndex] = spec;
    } else {
        arr.push(spec);
    }

    return wranglerJson;
}