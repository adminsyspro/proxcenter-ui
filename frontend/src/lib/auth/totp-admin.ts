import { Prisma } from "@prisma/client"
import { nanoid } from "nanoid"
import { hashRecoveryCode } from "./recovery"

type Tx = Prisma.TransactionClient

export async function clearUserTotp(tx: Tx, userId: string) {
  await tx.user.update({
    where: { id: userId },
    data: {
      totpSecretEnc: null,
      totpEnabled: false,
      totpEnrolledAt: null,
      totpLastUsedStep: null,
    },
  })
  await tx.userTotpRecoveryCode.deleteMany({ where: { userId } })
}

export async function replaceRecoveryCodes(
  tx: Tx,
  userId: string,
  plainCodes: string[],
  now: Date = new Date(),
) {
  const hashes = await Promise.all(plainCodes.map(hashRecoveryCode))
  await tx.userTotpRecoveryCode.deleteMany({ where: { userId } })
  await tx.userTotpRecoveryCode.createMany({
    data: hashes.map((codeHash) => ({
      id: nanoid(),
      userId,
      codeHash,
      createdAt: now,
    })),
  })
}
