import InstallPrompt from "@/components/pwa/InstallPrompt";
import InstallProvider from "@/components/pwa/InstallProvider";

/**
 * Everything under (dashboard) is signed-in only, so the install state and prompt are mounted here and
 * nowhere else. The provider is shared by the daily prompt and the "Install App" button in the header.
 */
export default function DashboardGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <InstallProvider>
      {children}
      <InstallPrompt />
    </InstallProvider>
  );
}
