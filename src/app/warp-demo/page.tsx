import { WarpBackground } from "@/components/ui/warp-background"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default function WarpBackgroundDemoPage() {
    return (
        <div className="flex items-center justify-center min-h-screen bg-background p-4">
            <WarpBackground className="w-full max-w-xl overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
                <Card className="w-full bg-transparent border-none shadow-none text-foreground z-50">
                    <CardHeader>
                        <CardTitle className="text-2xl font-bold">Warp Background</CardTitle>
                        <CardDescription>
                            Unique time-warping background effect for modern UIs.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <p className="text-muted-foreground">
                            This component adds a dynamic, sci-fi inspired depth effect to your cards and sections.
                            The beams are animated using Framer Motion for smooth performance.
                        </p>
                    </CardContent>
                </Card>
            </WarpBackground>
        </div>
    )
}
