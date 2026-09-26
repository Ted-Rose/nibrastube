import Link from "next/link";
import { AndroidAppLink } from "@/components/android-app-link";
import { Button } from "@/components/ui/button";
import { Video, ShieldCheck, Users, DeviceMobile, PlayCircle, Lock } from "@phosphor-icons/react/dist/ssr";

export default function LandingPage() {
  return (
    <div className="flex flex-col min-h-screen bg-slate-50 overflow-x-hidden">
      {/* Navigation */}
      <nav className="flex justify-between items-center px-6 py-8 max-w-7xl mx-auto w-full">
        <div className="flex items-center gap-2">
           <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center text-white shadow-lg shadow-primary/20">
              <PlayCircle size={28} weight="fill" />
           </div>
           <span className="text-2xl font-black tracking-tight text-slate-900">NibrasTube</span>
        </div>
        <div className="flex items-center gap-4">
           <Link href="/login">
             <Button variant="ghost" className="font-bold text-slate-600">Log in</Button>
           </Link>
           <Link href="/signup">
             <Button className="rounded-full px-8 py-6 text-lg font-bold shadow-xl shadow-primary/20">Get Started</Button>
           </Link>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="px-6 pt-16 pb-32 max-w-7xl mx-auto w-full">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
           <div className="space-y-8 text-center lg:text-left">
              <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-4 py-2 rounded-full font-bold text-sm tracking-wide uppercase">
                 <ShieldCheck weight="bold" /> 100% Human Curated
              </div>
              <h1 className="text-6xl md:text-8xl font-black text-slate-900 leading-[0.95] tracking-tighter">
                Safe videos, <br />
                <span className="text-primary">Parent approved.</span>
              </h1>
              <p className="text-xl md:text-2xl text-slate-600 font-medium leading-relaxed max-w-xl mx-auto lg:mx-0">
                Stop worrying about YouTube algorithms. NibrasTube lets you choose exactly what your kids can watch.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
                 <Link href="/signup">
                    <Button size="lg" className="h-16 px-10 rounded-2xl text-xl font-bold shadow-2xl shadow-primary/30">
                       Start Protected Browsing
                    </Button>
                 </Link>
                 <Link href="/kids">
                    <Button size="lg" variant="outline" className="h-16 px-10 rounded-2xl text-xl font-bold border-2 bg-white">
                       View Demo Kids Portal
                    </Button>
                 </Link>
              </div>
              <div className="flex items-center gap-4 justify-center lg:justify-start text-slate-400 font-bold">
                 <div className="flex -space-x-3">
                    {[1, 2, 3, 4].map(i => (
                       <div key={i} className="w-10 h-10 rounded-full border-2 border-white bg-slate-200 flex items-center justify-center text-sm">
                          {["👶", "👦", "👧", "🧒"][i-1]}
                       </div>
                    ))}
                 </div>
                 <span>Joined by 10,000+ safe-watching families</span>
              </div>
           </div>

           <div className="relative">
              <div className="absolute -inset-4 bg-primary/20 blur-[100px] rounded-full animate-pulse"></div>
              <div className="relative bg-white p-4 rounded-[40px] shadow-[0_50px_100px_-20px_rgba(0,0,0,0.15)] border-8 border-slate-100 transform rotate-2 hover:rotate-0 transition-transform duration-700">
                 <div className="aspect-video bg-slate-900 rounded-[24px] overflow-hidden flex items-center justify-center relative group">
                    <img 
                      src="https://images.unsplash.com/photo-1510333300264-DF47582483ce?auto=format&fit=crop&q=80&w=2000" 
                      className="w-full h-full object-cover opacity-80" 
                      alt="Safe content"
                    />
                    <div className="absolute inset-0 flex items-center justify-center">
                       <div className="w-20 h-20 bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center group-hover:scale-110 transition-transform cursor-pointer border-2 border-white/50">
                          <PlayCircle size={48} color="white" weight="fill" />
                       </div>
                    </div>
                 </div>
                 <div className="mt-8 grid grid-cols-2 gap-4">
                    <div className="h-12 bg-slate-50 rounded-2xl border-2 border-slate-100 flex items-center px-4 gap-2">
                       <ShieldCheck className="text-green-500" weight="fill" />
                       <span className="font-bold text-slate-400 text-sm">AD-FREE</span>
                    </div>
                    <div className="h-12 bg-slate-50 rounded-2xl border-2 border-slate-100 flex items-center px-4 gap-2">
                       <Lock className="text-blue-500" weight="fill" />
                       <span className="font-bold text-slate-400 text-sm">NO SEARCH</span>
                    </div>
                 </div>
              </div>
           </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="bg-white py-32 border-y border-slate-100 px-6">
         <div className="max-w-7xl mx-auto">
            <div className="text-center mb-20">
               <h2 className="text-4xl md:text-5xl font-black text-slate-900 tracking-tight">Everything for parent peace-of-mind.</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
               {[
                 { title: "Parent Portal", desc: "Whitelisting videos takes seconds. Search global YouTube and pin with one tap.", icon: Users, color: "bg-blue-500" },
                 { title: "Kids Portal", desc: "A playground where only your approved videos exist. No recommendations, no comments.", icon: DeviceMobile, color: "bg-purple-500" },
                 { title: "Real-time Sync", desc: "Pin a video on your phone, and it appears instantly on your kid's tablet.", icon: PlayCircle, color: "bg-orange-500" }
               ].map((feat, i) => (
                  <div key={i} className="group p-8 rounded-[32px] bg-slate-50 border-2 border-transparent hover:border-primary/20 hover:bg-white transition-all duration-300">
                     <div className={`w-14 h-14 ${feat.color} rounded-2xl flex items-center justify-center text-white mb-6 shadow-lg shadow-${feat.color.split('-')[1]}-500/20 group-hover:scale-110 transition-transform`}>
                        <feat.icon size={32} weight="bold" />
                     </div>
                     <h3 className="text-2xl font-black text-slate-900 mb-4">{feat.title}</h3>
                     <p className="text-lg text-slate-500 font-medium leading-relaxed">{feat.desc}</p>
                  </div>
               ))}
            </div>
         </div>
      </section>

      {/* Footer */}
      <footer className="py-20 px-6 max-w-7xl mx-auto w-full">
         <div className="flex flex-col md:flex-row justify-between items-center gap-8 border-t border-slate-200 pt-16">
            <div className="flex items-center gap-2 grayscale hover:grayscale-0 transition-all opacity-50 hover:opacity-100">
               <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center text-white">
                  <PlayCircle size={20} weight="fill" />
               </div>
               <span className="text-xl font-black tracking-tight text-slate-900">NibrasTube</span>
            </div>
            <AndroidAppLink />
            <p className="text-slate-400 font-bold">© 2026 NibrasTube. Curated with ❤️ for kids.</p>
         </div>
      </footer>
    </div>
  );
}
