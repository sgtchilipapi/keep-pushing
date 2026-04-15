import { notFound } from "next/navigation";

import RunResultPageView from "../../../components/game/RunResultPageView";
import { getRunResult } from "../../../lib/runResultService";

type PageProps = {
  params: Promise<{
    runId: string;
  }>;
};

export default async function RunResultPage(props: PageProps) {
  try {
    const { runId } = await props.params;
    const run = await getRunResult(runId);
    const origin = process.env.NEXT_PUBLIC_APP_ORIGIN ?? "http://localhost:3000";

    return <RunResultPageView run={run} origin={origin} />;
  } catch {
    notFound();
  }
}
