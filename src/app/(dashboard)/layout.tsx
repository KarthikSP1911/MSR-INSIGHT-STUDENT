import InstallPrompt from "@/components/pwa/InstallPrompt";

/** Everything under (dashboard) is signed-in only, so the install prompt is mounted here and nowhere else. */
export default function DashboardGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <InstallPrompt />
    </>
  );
}
