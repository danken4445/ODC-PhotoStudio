import type {
  CustomerDisplayPhase,
  CustomerDisplaySnapshot
} from '@odc-photostudio/contracts';

const CUSTOMER_MESSAGES: Record<CustomerDisplayPhase, string> = {
  idle: 'Step into frame',
  live: 'Look at the camera',
  countdown: 'Get ready',
  capturing: 'Hold that pose',
  preview: 'Looking good!',
  review: 'Your attendant is reviewing your photos',
  complete: 'All done — thank you!',
  recovering: 'One moment — your attendant is helping'
};

export interface CustomerDisplayViewModel {
  phase: CustomerDisplayPhase;
  message: string;
  progress: string | null;
  countdownValue: number | null;
  countdownLabel: string | null;
  mirrorLiveView: boolean;
}

export function toCustomerDisplayViewModel(
  snapshot: CustomerDisplaySnapshot
): CustomerDisplayViewModel {
  const progress =
    snapshot.shotIndex !== null && snapshot.shotCount > 0
      ? `Photo ${snapshot.shotIndex + 1} of ${snapshot.shotCount}`
      : null;
  return {
    phase: snapshot.phase,
    message: CUSTOMER_MESSAGES[snapshot.phase],
    progress,
    countdownValue: snapshot.countdownValue,
    countdownLabel:
      snapshot.countdownValue === null ? null : `Photo in ${snapshot.countdownValue}`,
    mirrorLiveView: snapshot.mirroredLiveView && snapshot.phase !== 'preview'
  };
}
