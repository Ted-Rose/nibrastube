import { SpinnerGap } from "@phosphor-icons/react/dist/ssr";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function SidebarCardFallback({
  icon,
  title,
}: {
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center">
          {icon} {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex justify-center py-8">
        <SpinnerGap size={24} className="animate-spin text-muted-foreground" />
      </CardContent>
    </Card>
  );
}

export function SearchResultsFallback() {
  return (
    <div
      className={cn(
        "flex items-center justify-center py-20",
        "text-muted-foreground"
      )}
    >
      <SpinnerGap size={32} className="animate-spin" />
    </div>
  );
}
