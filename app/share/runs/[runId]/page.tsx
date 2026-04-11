import { notFound } from "next/navigation";

import RunResultPageView from "../../../../components/game/RunResultPageView";
import { getRunResult } from "../../../../lib/runResultService";

type PageProps = {
  params: {
    runId: string;
  };
};

export default async function SharedRunPage(props: PageProps) {
  try {
    const run = await getRunResult(props.params.runId);
    const origin = process.env.NEXT_PUBLIC_APP_ORIGIN ?? "http://localhost:3000";

    return <RunResultPageView run={run} publicView origin={origin} />;
  } catch {
    notFound();
  }
}
