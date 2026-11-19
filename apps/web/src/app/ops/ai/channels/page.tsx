import { Channels } from "@/features/engage/components/channels";
import { loadChannelBoard } from "@/features/engage/service";

/** S-61: the channels the platform talks to the outside world through. */
export default async function Page() {
  const { channels, configs, targets } = await loadChannelBoard();
  return <Channels channels={channels} configs={configs} targets={targets} />;
}
