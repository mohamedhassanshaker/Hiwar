import { widgetContext } from "@/server/widget";
import { Widget } from "./widget";

export const metadata = { title: "Chat", robots: { index: false } };

/** The widget frame (DEP-003). The proxy sets `frame-ancestors` to the deployment's listed origins. */
export default async function WidgetFrame({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ page?: string; preview?: string }> }) {
  const { key } = await params;
  const { page, preview } = await searchParams;
  try {
    await widgetContext(key);
  } catch {
    return null;
  }
  return <Widget widgetKey={key} page={page ?? ""} preview={preview === "1"} />;
}
