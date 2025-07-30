import {QqlDriverD1, R2Storage} from "katnip/qql";

export async function createCloudflareQqlDriver({env}) {
	if (!env.DATABASE_URL && env.DB)
		return new QqlDriverD1(env.DB);
}

export async function createCloudflareStorageDriver({env}) {
	//console.log("creating storage driver");

	if (!env.DATABASE_STORAGE_URL && env.BUCKET)
		return new R2Storage(env.BUCKET);
}
