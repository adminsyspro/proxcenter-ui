-- CreateEnum
CREATE TYPE "K8sDistro" AS ENUM ('k3s', 'kubeadm', 'generic', 'talos', 'rke2');

-- CreateEnum
CREATE TYPE "K8sSource" AS ENUM ('imported', 'deployed');

-- CreateEnum
CREATE TYPE "K8sCredentialType" AS ENUM ('token', 'client_cert');

-- CreateEnum
CREATE TYPE "K8sHealthState" AS ENUM ('healthy', 'degraded', 'unreachable', 'auth_failed', 'stale', 'unknown');

-- CreateTable
CREATE TABLE "kubernetes_clusters" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cluster_uid" TEXT,
    "context_name" TEXT,
    "distro" "K8sDistro" NOT NULL DEFAULT 'generic',
    "source" "K8sSource" NOT NULL DEFAULT 'imported',
    "api_server_url" TEXT NOT NULL,
    "ca_data_pem" TEXT,
    "tls_server_name" TEXT,
    "insecure_skip_tls_verify" BOOLEAN NOT NULL DEFAULT false,
    "credential_enc" TEXT NOT NULL,
    "credential_type" "K8sCredentialType" NOT NULL,
    "credential_version" INTEGER NOT NULL DEFAULT 1,
    "credential_updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "proxmox_connection_id" TEXT,
    "version" TEXT,
    "health_state" "K8sHealthState" NOT NULL DEFAULT 'unknown',
    "health_detail" JSONB,
    "last_health_at" TIMESTAMP(3),
    "last_success_at" TIMESTAMP(3),
    "last_failure_at" TIMESTAMP(3),
    "last_error_code" TEXT,
    "last_error_message" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kubernetes_clusters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "kubernetes_clusters_tenant_id_idx" ON "kubernetes_clusters"("tenant_id");

-- CreateIndex
CREATE INDEX "kubernetes_clusters_tenant_id_api_server_url_idx" ON "kubernetes_clusters"("tenant_id", "api_server_url");

-- CreateIndex
CREATE UNIQUE INDEX "kubernetes_clusters_tenant_id_name_key" ON "kubernetes_clusters"("tenant_id", "name");

-- CreateTable
CREATE TABLE "kubernetes_cluster_nodes" (
    "id" TEXT NOT NULL,
    "cluster_id" TEXT NOT NULL,
    "node_name" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "vmid" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kubernetes_cluster_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "kubernetes_cluster_nodes_cluster_id_node_name_key" ON "kubernetes_cluster_nodes"("cluster_id", "node_name");
