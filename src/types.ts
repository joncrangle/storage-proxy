import type { GetObjectCommandOutput } from "@aws-sdk/client-s3";
import type { BlobDownloadResponseModel } from "@azure/storage-blob";
import type { Request } from "express";
import type { z } from "zod";
import type {
	containerNameSchema,
	fileContentSchema,
	filenameSchema,
	fileRouteSchema,
	jwtUserSchema,
	sessionUserSchema,
} from "@/schemas";

export type ContainerName = z.infer<typeof containerNameSchema>;
export type Filename = z.infer<typeof filenameSchema>;
export type FileContent = z.infer<typeof fileContentSchema>;
export type FileRoute = z.infer<typeof fileRouteSchema>;
export type JwtUser = z.infer<typeof jwtUserSchema>;
export type SessionUser = z.infer<typeof sessionUserSchema>;

export type CustomSession = import("express-session").Session & {
	user?: SessionUser;
	returnTo?: string;
};

export interface CustomRequest extends Request {
	id?: string;
	session: CustomSession;
	jwtUser?: JwtUser;
}

export type BlobProperties = {
	contentLength?: number;
	lastModified?: Date;
	etag?: string;
	contentType?: string;
};

export type StorageBlobProperties = {
	exists: boolean;
} & Partial<BlobProperties>;

export type BlobInfo = {
	name?: string;
	properties: BlobProperties;
};

export type ContainerInfo = {
	name: string;
	status?: string;
	blobs?: BlobInfo[];
	error?: string;
};

export type ContainersAndBlobs = Promise<ContainerInfo[]>;

export type BlobDownloadResponse =
	| { readableStreamBody: GetObjectCommandOutput["Body"] } // S3 format
	| BlobDownloadResponseModel; // Azure format

export interface StorageImpl {
	getBlobProperties(
		container: string,
		blobPath: string,
	): Promise<StorageBlobProperties>;

	downloadBlob(
		container: string,
		blobPath: string,
	): Promise<BlobDownloadResponse>;

	listContainersAndBlobs(): ContainersAndBlobs;
}
