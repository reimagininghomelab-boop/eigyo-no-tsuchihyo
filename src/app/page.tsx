'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import Header from '@/components/Header'
import Footer from '@/components/Footer'

// ─── アイコン（ティール線アイコン） ──────────────────────────────
const ICON_STROKE = '#488a99'

function ChatIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={ICON_STROKE} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  )
}

function TargetIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={ICON_STROKE} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.4" fill={ICON_STROKE} stroke="none" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={ICON_STROKE} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  )
}

function EarIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={ICON_STROKE} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 8.5a6 6 0 0 1 12 0c0 3.5-2.5 4.7-3.6 6.2-.7 1-.4 2.8-2.4 2.8a2.5 2.5 0 0 1-2.5-2.5" />
      <path d="M9 8.5a3 3 0 0 1 5.5-1.5" />
    </svg>
  )
}

function BulbIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={ICON_STROKE} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 18h6" />
      <path d="M10 21h4" />
      <path d="M12 3a6 6 0 0 0-4 10.5c.6.6 1 1.3 1 2.1V16h6v-.4c0-.8.4-1.5 1-2.1A6 6 0 0 0 12 3z" />
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={ICON_STROKE} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  )
}

// ─── TOPページ ────────────────────────────────────────────────────
export default function TopPage() {
  const router = useRouter()

  useEffect(() => {
    // メールリンクのハッシュリダイレクト処理
    const hash = window.location.hash
    if (hash.includes('type=recovery')) {
      window.location.href = '/auth/reset' + hash
      return
    }
    if (hash.includes('type=signup')) {
      window.location.href = '/salesperson/register' + hash
      return
    }

    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      supabase
        .from('salesperson_profiles')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle()
        .then(({ data: profile }) => {
          if (profile) router.replace('/salesperson/dashboard')
        })
    })
  }, [router])

  return (
    <main className="min-h-screen bg-white text-[#2d3436]">
      <Header />

      {/* ヒーロー */}
      <section className="px-6 py-16 md:py-24">
        <div className="max-w-xl mx-auto text-center">
          <h1 className="text-[26px] md:text-[28px] font-bold leading-snug mb-5">
            住宅会社は選んだ。<br />
            担当者は？ <span className="text-[#488a99]">ERABERU。</span>
          </h1>
          <p className="text-[13px] text-[#7a8385] leading-relaxed mb-9">
            同じ会社でも、担当者が変わると<br />
            家づくりの体験はまったく変わります。
          </p>
          <Link
            href="/search"
            className="inline-block bg-[#488a99] hover:bg-[#3d7684] text-white font-bold px-10 py-4 rounded-[10px] text-sm transition shadow-sm"
          >
            あなたの担当者をさがす
          </Link>
          <p className="text-[11px] text-[#96a0a2] mt-4">
            まずは気になる会社の担当者をチェック
          </p>
        </div>
      </section>

      {/* 価値セクション */}
      <section className="bg-[#F2F7F8] px-6 py-16">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-10">
            <h2 className="text-[17px] font-bold mb-2">
              比較はする。<span className="text-[#488a99]">追客はさせない。</span>
            </h2>
            <p className="text-[12px] text-[#7a8385]">
              家族の家づくりは、家族のペースで。
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-3xl mx-auto">
            {[
              { icon: <ChatIcon />, title: '口コミで比較', desc: '経験者の声で評判を確認' },
              { icon: <TargetIcon />, title: '相性で探す', desc: '自分に合うタイプで絞る' },
              { icon: <LockIcon />, title: '施主からオファー', desc: '気に入った人にだけ連絡' },
            ].map((item) => (
              <div key={item.title} className="bg-white rounded-xl p-7 text-center">
                <span className="flex justify-center mb-4">{item.icon}</span>
                <h3 className="text-sm font-bold mb-1.5">{item.title}</h3>
                <p className="text-[12px] text-[#7a8385] leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* メリットセクション */}
      <section className="bg-white px-6 py-16">
        <div className="max-w-xl mx-auto">
          <div className="text-center mb-9">
            <h2 className="text-[17px] font-bold mb-2">
              担当者が変わると、<span className="text-[#488a99]">進め方が変わる。</span>
            </h2>
            <p className="text-[12px] text-[#7a8385] leading-relaxed">
              じっくり考えたいのか、どんどん提案してほしいのか。<br />
              家づくりの進め方は、担当者しだいで大きく変わります。
            </p>
          </div>
          <div className="space-y-3">
            {[
              { icon: <EarIcon />, title: '要望をよく聞いてくれた', desc: 'こちらのペースを尊重してくれるタイプ' },
              { icon: <BulbIcon />, title: '思いつかない提案をくれた', desc: '選択肢を広げてくれるタイプ' },
              { icon: <ClockIcon />, title: '急かさず待ってくれた', desc: '家族で話す時間をくれるタイプ' },
            ].map((item) => (
              <div key={item.title} className="flex items-center gap-4 bg-[#F7FAFB] rounded-[10px] px-5 py-4">
                <span className="shrink-0">{item.icon}</span>
                <div>
                  <p className="text-sm font-bold">{item.title}</p>
                  <p className="text-[12px] text-[#7a8385]">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-[#96a0a2] text-center leading-relaxed mt-9">
            実際に建てた施主が、その担当者の何を評価したのか。<br />
            口コミの傾向から、進め方が見えてきます。
          </p>
        </div>
      </section>

      <Footer />
    </main>
  )
}
