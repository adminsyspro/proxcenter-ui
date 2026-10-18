-- Whether ManagedHost.ip was read off the node's management interface
-- (gateway interface or vmbr0). False for a guess: a privilege-filtered
-- interface list, or the corosync link address of a node that did not answer.
ALTER TABLE "ManagedHost" ADD COLUMN "ipVerified" BOOLEAN NOT NULL DEFAULT true;
