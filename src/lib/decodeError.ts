/**
 * Contract revert decoder.
 *
 * wagmi/viem auto-decodes errors when the write call passes the matching ABI
 * (e.g., `vault.deposit` → vault errors decoded). If the error originates in
 * a different contract (rare), the fallback returns viem's short message.
 *
 * The friendly-name map covers errors we expect to surface from Mint / Redeem
 * / Claim / Register flows. Add more as new flows expose them.
 */

import { BaseError, ContractFunctionRevertedError } from "viem";

export type DecodedError = {
  /** Solidity custom-error name (or "Error" / "Unknown"). */
  name: string;
  /** Human-readable message for the user. */
  message: string;
  /** Raw args from the revert, when present. */
  args?: readonly unknown[];
};

export function decodeContractError(err: unknown): DecodedError {
  if (!(err instanceof BaseError)) {
    return {
      name: "Error",
      message: (err as Error)?.message || String(err),
    };
  }

  // viem nests ContractFunctionRevertedError inside BaseError.cause chain.
  const reverted = err.walk(
    (e) => e instanceof ContractFunctionRevertedError,
  ) as ContractFunctionRevertedError | undefined;

  if (reverted?.data) {
    const name = reverted.data.errorName ?? "Unknown";
    return {
      name,
      args: reverted.data.args,
      message: friendlyMessage(name, reverted.data.args),
    };
  }

  // User rejected in wallet → very common, handle explicitly.
  if (
    err.shortMessage?.includes("User rejected") ||
    err.message.includes("User rejected") ||
    err.message.includes("user rejected")
  ) {
    return {
      name: "UserRejected",
      message: "지갑에서 트랜잭션이 거부되었습니다.",
    };
  }

  return {
    name: "Error",
    message: err.shortMessage || err.message,
  };
}

function friendlyMessage(name: string, args?: readonly unknown[]): string {
  switch (name) {
    // Phase / lifecycle
    case "MintsDisabled":
      return "Wind-down 중에는 입금할 수 없습니다.";
    case "WrongPhase":
      return "현재 phase에서는 이 작업이 허용되지 않습니다.";
    case "OnlyFounderDuringIncubation":
      return "Incubation 기간에는 founder만 입금할 수 있습니다.";
    case "WindDownActive":
      return "이미 wind-down이 진행 중입니다.";
    case "WindDownNotActive":
      return "Wind-down이 활성화되지 않았습니다.";
    case "AlreadySettled":
      return "이미 청산이 완료되었습니다.";
    case "SeniorWindowOpen":
      return `Senior 환매 윈도우가 열려있습니다. ${formatUnixArg(args?.[0])}에 종료됩니다.`;
    case "PositionsNotLiquidated":
      return `잔여 포지션 ${args?.[0] ?? "?"}개가 청산되지 않았습니다.`;

    // Pricing / oracle
    case "PriceStale":
      return "Pyth 가격이 stale 상태입니다. Pyth 갱신을 다시 시도해주세요.";
    case "PriceNegative":
      return "Pyth가 음수 가격을 반환했습니다 — oracle 점검이 필요합니다.";
    case "InsufficientUpdateFee":
      return "Pyth 갱신 수수료(MNT)가 부족합니다.";
    case "UnknownFeed":
      return "등록되지 않은 가격 feed입니다.";

    // Balance / shares
    case "InsufficientCash":
      return "Vault USDC 잔액이 부족합니다. 환매 큐 / 리밸런싱을 기다려주세요.";
    case "InsufficientShares":
      return "Shares가 부족합니다.";
    case "InsufficientSeed":
      return "최소 시드 자본 (1,000 USDC) 미만입니다.";
    case "ZeroAmount":
      return "금액은 0보다 커야 합니다.";
    case "ZeroAddress":
      return "유효하지 않은 주소입니다.";

    // Mandate / weights
    case "MandateBreach":
      return "Mandate weight 제약을 위반했습니다.";
    case "MandateInvalid":
      return "Mandate가 유효하지 않습니다.";
    case "MandateAlreadyUsed":
      return "이미 사용된 mandate hash입니다.";
    case "AssetNotWhitelisted":
      return "Whitelist에 없는 자산입니다.";

    // Redemption queue
    case "TierNotAllowedByMandate":
      return "이 락업 옵션은 mandate에서 허용되지 않았습니다.";
    case "StillLocked":
      return `아직 락업 기간 중입니다. ${formatUnixArg(args?.[0])} 이후 청구 가능.`;
    case "NotRequestOwner":
      return "다른 사용자의 환매 요청은 처리할 수 없습니다.";
    case "AlreadyClaimed":
      return "이미 청구된 항목입니다.";
    case "AlreadyCancelled":
      return "이미 취소된 환매 요청입니다.";
    case "CancelWindowClosed":
      return "취소 가능 기간이 종료됐습니다. (만료 1일 전까지만 가능)";

    // Founder vault
    case "SubordinationBreached":
      return "Founder 출금 한도(40%)를 초과합니다.";
    case "LockupActive":
      return `Founder 락업이 활성화되어 있습니다. ${formatUnixArg(args?.[0])} 이후 인출 가능.`;
    case "NotFounder":
    case "OnlyFounder":
      return "Founder만 호출할 수 있는 함수입니다.";
    case "NoCarryToClaim":
      return "청구 가능한 carry가 없습니다.";

    // Incubation
    case "IncubationNotComplete":
      return "Incubation 30일이 아직 끝나지 않았습니다.";
    case "AlreadyAdvanced":
      return "이미 PublicLaunch로 진행되었습니다.";

    // Auth
    case "OnlyAdmin":
    case "NotAdmin":
      return "Admin만 호출할 수 있는 함수입니다.";
    case "OnlyVault":
    case "NotVault":
      return "Vault만 호출할 수 있는 함수입니다.";
    case "OnlyExecutor":
      return "Executor만 호출할 수 있는 함수입니다.";
    case "OnlyHarvester":
    case "NotHarvester":
      return "Harvester만 호출할 수 있는 함수입니다.";
    case "OnlyRedemptionQueue":
      return "RedemptionQueue만 호출할 수 있는 함수입니다.";
    case "OnlyRegistry":
      return "Registry만 호출할 수 있는 함수입니다.";
    case "OnlyDistributor":
      return "DividendDistributor만 호출할 수 있는 함수입니다.";
    case "OnlyRegisteredVault":
      return "등록된 vault만 호출할 수 있습니다.";

    // ERC-20 / token transfers
    case "TransfersDisabled":
    case "TransfersFrozen":
      return "현재 phase에서는 토큰 전송이 비활성화되어 있습니다.";

    case "UserRejected":
      return "지갑에서 트랜잭션이 거부되었습니다.";

    default:
      return name; // Show the custom error name as-is for unknown cases.
  }
}

function formatUnixArg(v: unknown): string {
  if (typeof v !== "bigint" && typeof v !== "number") return "—";
  const ts = Number(v);
  if (!Number.isFinite(ts) || ts <= 0) return "—";
  return new Date(ts * 1000).toLocaleString();
}
