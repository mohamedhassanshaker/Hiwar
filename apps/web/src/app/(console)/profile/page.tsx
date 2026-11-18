import { MyProfile } from "@/features/organisation/components/profile";
import { loadMyProfile } from "@/features/organisation/service";

/** S-04 and S-05: my profile and my security. */
export default async function Page() {
  return <MyProfile data={await loadMyProfile()} />;
}
