import { cookies } from "next/headers";
import { ShelfView } from "../../../components/shelf-view";
import {
  resolveShelfTheme,
  SHELF_THEME_COOKIE_NAME,
} from "../../../shared/shelf-themes";

interface ShelfPageProps {
  params: Promise<{ username: string }>;
}

export default async function ShelfPage({ params }: ShelfPageProps) {
  const [{ username }, cookieStore] = await Promise.all([params, cookies()]);
  const theme = resolveShelfTheme(
    cookieStore.get(SHELF_THEME_COOKIE_NAME)?.value,
  );

  return (
    <main className="shelf-route">
      <ShelfView username={username} theme={theme} />
    </main>
  );
}
