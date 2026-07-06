import { StoryPage } from "@/components/v3"
import { storyPages } from "@/lib/v3"

export default function Page() {
  return <StoryPage page={storyPages["for-haulers"]!} />
}
