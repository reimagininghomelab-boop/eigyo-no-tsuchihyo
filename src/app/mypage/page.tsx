'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import Header from '@/components/Header'

const REVIEW_PHASES = [
  { value: 'pre_contract', label: '契約前', icon: '📋', qrOnly: true },
  { value: 'post_contract', label: '契約後', icon: '✍️', qrOnly: false },
  { value: 'after_start', label: '着工後', icon: '🏗️', qrOnly: false },
  { value: 'after_handover', label: '引渡後', icon: '🏠', qrOnly: false },
] as const

type PhaseValue = typeof REVIEW_PHASES[number]['value']

type Review = {
  id: string
  salesperson_id: string
  phase: PhaseValue
  rating: number | null
  content: string
  status: string
  display_state: string
  moderation_state: string
  review_state: string
  created_at: string
}

type Offer = {
  id: string
  salesperson_id: string
  area: string | null
  timing: string | null
  message: string
  status: string
  created_at: string
}

type Salesperson = {
  id: string
  company_name: string
  name_initials: string | null
  profile_image_url: string | null
}

// 施主が接点を持った全営業（オファーまたは口コミ）
type ContactGroup = {
  salesperson: Salesperson
  offers: Offer[]
  reviews: Review[]
  availablePhases: { value: PhaseValue; label: string; icon: string }[]
  hasReview: boolean
  hasOffer: boolean
}

export default function MyPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [groups, setGroups] = useState<ContactGroup[]>([])
  const [activeTab, setActiveTab] = useState<'all' | 'offers' | 'reviews'>('all')

  useEffect(() => {
    const supabase = createClient()
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.replace('/auth/login'); return }

      const [
        { data: myReviews },
        { data: myOffers },
      ] = await Promise.all([
        supabase
          .from('anonymous_reviews')
          .select('id, salesperson_id, phase, rating, content, status, display_state, moderation_state, review_state, created_at')
          .eq('user_id', user.id)
          .neq('review_state', 'superseded')
          .order('created_at', { ascending: false }),
        supabase
          .from('offers')
          .select('id, salesperson_id, area, timing, message, status, created_at')
          .eq('buyer_id', user.id)
          .order('created_at', { ascending: false }),
      ])

      const reviewList: Review[] = myReviews ?? []
      const offerList: Offer[] = myOffers ?? []

      // 接点を持った営業IDを集約
      const spIds = [
        ...new Set([
          ...reviewList.map((r) => r.salesperson_id),
          ...offerList.map((o) => o.salesperson_id),
        ]),
      ]

      if (spIds.length === 0) { setLoading(false); return }

      const { data: salespeople } = await supabase
        .from('safe_salesperson_profiles')
        .select('id, company_name, name_initials, profile_image_url')
        .in('id', spIds)

      const spMap: Record<string, Salesperson> = {}
      ;(salespeople ?? []).forEach((sp: Salesperson) => { spMap[sp.id] = sp })

      const writablePhases = REVIEW_PHASES.filter((p) => !p.qrOnly)

      const result: ContactGroup[] = spIds
        .filter((id) => spMap[id])
        .map((id) => {
          const reviews = reviewList.filter((r) => r.salesperson_id === id)
          const offers = offerList.filter((o) => o.salesperson_id === id)
          const submittedPhaseValues = reviews.map((r) => r.phase)
          const availablePhases = writablePhases
            .filter((p) => !submittedPhaseValues.includes(p.value))
            .map((p) => ({ value: p.value, label: p.label, icon: p.icon }))
          return {
            salesperson: spMap[id],
            offers,
            reviews,
            availablePhases,
            hasReview: reviews.length > 0,
            hasOffer: offers.length > 0,
          }
        })

      setGroups(result)
      setLoading(false)
    }
    load()
  }, [router])

  if (loading) return <div className="min-h-screen bg-stone-100 flex items-center justify-center text-gray-400">読み込み中...</div>

  const filteredGroups = activeTab === 'offers'
    ? groups.filter((g) => g.hasOffer)
    : activeTab === 'reviews'
    ? groups.filter((g) => g.hasReview)
    : groups

  // 相談済みで口コミ未投稿の営業数
  const pendingReviewCount = groups.filter((g) => g.hasOffer && !g.hasReview).length

  return (
    <main className="min-h-screen bg-stone-100">
      <Header />

      <div className="max-w-2xl mx-auto px-4 py-8 space-y-4">
        <div>
          <h1 className="text-xl font-bold text-gray-800">相談・口コミ管理</h1>
          <p className="text-xs text-gray-500 mt-1">相談した営業・投稿済み口コミを確認できます</p>
        </div>

        {/* 口コミ投稿促進バナー */}
        {pendingReviewCount > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4 space-y-2">
            <p className="text-sm font-bold text-amber-700">
              相談した営業の口コミを残しませんか？
            </p>
            <p className="text-xs text-amber-600 leading-relaxed">
              {pendingReviewCount}件の相談済み営業の口コミがまだありません。口コミを投稿すると、検索時に接点のある営業がメイン一覧から外れ、新しい営業を探しやすくなります。
            </p>
          </div>
        )}

        {/* タブ */}
        <div className="flex bg-stone-200 rounded-xl p-1 gap-1">
          {([
            { key: 'all', label: `すべて (${groups.length})` },
            { key: 'offers', label: `相談 (${groups.filter(g => g.hasOffer).length})` },
            { key: 'reviews', label: `口コミ (${groups.filter(g => g.hasReview).length})` },
          ] as { key: typeof activeTab; label: string }[]).map((t) => (
            <button key={t.key} onClick={() => setActiveTab(t.key)}
              className={`flex-1 text-xs font-medium py-2 rounded-lg transition ${activeTab === t.key ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {filteredGroups.length === 0 ? (
          <div className="bg-white rounded-2xl border border-stone-200 p-10 text-center space-y-3">
            <p className="text-3xl">📋</p>
            <p className="text-sm font-bold text-gray-600">
              {activeTab === 'all' ? 'まだ接点のある営業マンがいません' :
               activeTab === 'offers' ? '相談済みの営業マンはいません' :
               '口コミ投稿済みの営業マンはいません'}
            </p>
            {activeTab === 'all' && (
              <Link href="/search" className="inline-block text-sm text-teal-600 hover:underline">
                営業マンを探す →
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {filteredGroups.map(({ salesperson, offers, reviews, availablePhases, hasOffer, hasReview }) => (
              <div key={salesperson.id} className="bg-white rounded-2xl border border-stone-200 p-5 space-y-4">
                {/* 営業マン情報 */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full overflow-hidden bg-stone-100 flex items-center justify-center shrink-0">
                      {salesperson.profile_image_url
                        ? <img src={salesperson.profile_image_url} alt="" className="w-full h-full object-cover" />
                        : <span className="text-2xl">👤</span>}
                    </div>
                    <div>
                      <p className="text-xs text-gray-400">{salesperson.company_name}</p>
                      <p className="text-sm font-bold text-gray-800">
                        {salesperson.name_initials ? `${salesperson.name_initials} さん` : '---'}
                      </p>
                      <div className="flex gap-1.5 mt-0.5">
                        {hasOffer && <span className="text-xs bg-teal-50 text-teal-600 px-1.5 py-0.5 rounded-full">相談済み</span>}
                        {hasReview && <span className="text-xs bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded-full">口コミ投稿済み</span>}
                      </div>
                    </div>
                  </div>
                  <Link href={`/salesperson/${salesperson.id}`}
                    className="text-xs text-teal-600 border border-teal-200 px-3 py-1.5 rounded-lg hover:bg-teal-50 transition shrink-0">
                    プロフィール
                  </Link>
                </div>

                {/* 相談リクエスト一覧 */}
                {offers.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-bold text-gray-500">相談リクエスト</p>
                    {offers.map((o) => (
                      <div key={o.id} className="bg-stone-50 rounded-xl border border-stone-100 px-4 py-3 text-xs space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-gray-400">{new Date(o.created_at).toLocaleDateString('ja-JP')}</span>
                          <span className={`px-2 py-0.5 rounded-full font-medium ${o.status === 'new' ? 'bg-teal-100 text-teal-700' : 'bg-stone-100 text-stone-500'}`}>
                            {o.status === 'new' ? '送信済み' : '対応済み'}
                          </span>
                        </div>
                        {(o.area || o.timing) && (
                          <p className="text-gray-500">
                            {o.area && `📍 ${o.area}`}{o.area && o.timing && '　'}{o.timing && `🕐 ${o.timing}`}
                          </p>
                        )}
                        <p className="text-gray-600 line-clamp-2">{o.message}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* 口コミ投稿済み */}
                {reviews.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-bold text-gray-500">投稿済み口コミ</p>
                    {reviews.map((r) => {
                      const phase = REVIEW_PHASES.find((p) => p.value === r.phase)
                      // 状態は3軸で判定（旧statusは意味判断に使わない）。unconfirmedは「確認待ち」
                      const stateLabel =
                        r.review_state === 'superseded' ? { text: '更新済み', cls: 'bg-stone-100 text-stone-500' } :
                        r.moderation_state === 'violation' ? { text: '運営審査により非表示', cls: 'bg-red-100 text-red-600' } :
                        (r.display_state === 'visible' && r.moderation_state === 'none' && r.review_state === 'active')
                          ? { text: '公開中', cls: 'bg-green-100 text-green-600' } :
                        r.display_state === 'concealed' ? { text: '非公開', cls: 'bg-stone-100 text-stone-500' } :
                        { text: '確認待ち', cls: 'bg-amber-100 text-amber-600' } // unconfirmed 等
                      return (
                        <div key={r.id} className="bg-stone-50 rounded-xl border border-stone-100 px-4 py-3">
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-xs text-stone-600 border border-stone-200 bg-white px-2 py-0.5 rounded-full">
                              {phase?.icon} {phase?.label ?? r.phase}
                            </span>
                            <span className={`text-xs px-2 py-0.5 rounded-full ${stateLabel.cls}`}>
                              {stateLabel.text}
                            </span>
                          </div>
                          {r.rating && (
                            <p className="text-xs text-amber-400 mb-1">
                              {'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}
                            </p>
                          )}
                          <p className="text-sm text-gray-700 leading-relaxed line-clamp-3">{r.content}</p>
                          <p className="text-xs text-gray-400 mt-1.5">{new Date(r.created_at).toLocaleDateString('ja-JP')}</p>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* 口コミ投稿入口 */}
                <div className="space-y-2">
                  {/* 相談済みで口コミ未投稿の場合：最初の口コミ促進 */}
                  {hasOffer && !hasReview && (
                    <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
                      <p className="text-xs text-amber-700 mb-2 leading-relaxed">
                        この営業マンにやりとりした印象を口コミとして残せます。
                      </p>
                      <Link href={`/review/write/${salesperson.id}`}
                        className="inline-block text-xs bg-amber-500 hover:bg-amber-400 text-white font-bold px-4 py-2 rounded-lg transition">
                        やりとりした印象を投稿する
                      </Link>
                    </div>
                  )}

                  {/* 追加投稿できるフェーズ */}
                  {availablePhases.length > 0 && hasReview && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-bold text-gray-500">追加で投稿できるフェーズ</p>
                      {availablePhases.map((p) => (
                        <Link key={p.value} href={`/review/write/${salesperson.id}`}
                          className="flex items-center justify-between px-4 py-3 rounded-xl border border-teal-100 bg-teal-50 hover:bg-teal-100 transition">
                          <span className="text-sm text-teal-700 font-medium">{p.icon} {p.label}の口コミを投稿する</span>
                          <span className="text-teal-500 text-sm">→</span>
                        </Link>
                      ))}
                    </div>
                  )}

                  {/* 全フェーズ投稿済み */}
                  {availablePhases.length === 0 && hasReview && (
                    <p className="text-xs text-gray-400 text-center py-1">すべてのフェーズの口コミを投稿済みです ✓</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 使い方案内 */}
        <div className="bg-stone-50 rounded-xl border border-stone-200 px-4 py-3">
          <p className="text-xs text-gray-500 leading-relaxed">
            <span className="font-bold text-gray-600">口コミ投稿について：</span>
            契約前の口コミは営業担当から受け取ったQRコードから投稿できます。
            相談・口コミ後・着工後・引渡後はこのページから投稿できます。
          </p>
        </div>
      </div>
    </main>
  )
}
