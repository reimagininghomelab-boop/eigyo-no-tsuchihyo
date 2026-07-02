'use client'
import { useEffect, useState, Suspense } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import Header from '@/components/Header'
import type { User } from '@supabase/supabase-js'

const OFFER_TIMINGS = ['3ヶ月以内', '半年以内', '1年以内', 'まだ未定'] as const

const SALES_STYLE_AXES = [
  { key: 'listening_proposing', left: '傾聴型', right: '提案型' },
  { key: 'numbers_feeling', left: '数字で説明', right: '感覚で説明' },
]
const SUPABASE_FUNCTIONS_URL = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1`

function SalespersonDetailContent() {
  const { id } = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const isPreview = searchParams.get('preview') === '1'
  const [agent, setAgent] = useState<any>(null)
  const [unlockedData, setUnlockedData] = useState<any>(null)
  const [user, setUser] = useState<User | null>(null)
  const [paying, setPaying] = useState(false)
  const [payError, setPayError] = useState('')
  const [reviews, setReviews] = useState<any[]>([])
  const [reviewStats, setReviewStats] = useState<{ total: number; visible: number; rate: number | null; avg_rating: number | null } | null>(null)
  const [isFavorited, setIsFavorited] = useState(false)
  const [favoriteLoading, setFavoriteLoading] = useState(false)
  const [allAnonReviews, setAllAnonReviews] = useState<any[]>([])
  const [phaseFilter, setPhaseFilter] = useState<string>('all')
  const [userSubmittedPhases, setUserSubmittedPhases] = useState<string[]>([])
  const [myReviewIds, setMyReviewIds] = useState<Set<string>>(new Set())
  const [ownReview, setOwnReview] = useState<any>(null)
  // オファーフォーム
  const [showOfferForm, setShowOfferForm] = useState(false)
  const [offerArea, setOfferArea] = useState('')
  const [offerTiming, setOfferTiming] = useState('')
  const [offerMessage, setOfferMessage] = useState('')
  const [offerName, setOfferName] = useState('')
  const [offerSending, setOfferSending] = useState(false)
  const [offerDone, setOfferDone] = useState(false)
  const [offerError, setOfferError] = useState('')
  const [showConfirmModal, setShowConfirmModal] = useState(false)

  const PHASE_META: Record<string, { label: string; bg: string; border: string; text: string }> = {
    pre_contract:   { label: '契約前', bg: 'bg-teal-50',   border: 'border-teal-200',   text: 'text-teal-700' },
    post_contract:  { label: '契約後', bg: 'bg-blue-50',   border: 'border-blue-200',   text: 'text-blue-700' },
    after_start:    { label: '着工後', bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-700' },
    after_handover: { label: '引渡後', bg: 'bg-green-50',  border: 'border-green-200',  text: 'text-green-700' },
  }

  const fetchReviews = async (supabase: ReturnType<typeof createClient>, currentUserId: string) => {
    // 自分の口コミのみ取得（RLS "users can view own reviews" で自分の行のみ返る）
    const { data: ownData } = await supabase
      .from('contract_reviews')
      .select('id, rating, contract_price, content, created_at, meeting_status, is_approved')
      .eq('salesperson_id', id)
      .eq('user_id', currentUserId)
      .maybeSingle()
    setOwnReview(ownData ?? null)

    // 他人の承認済み口コミ（user_id は取得しない）
    const { data } = await supabase
      .from('contract_reviews')
      .select('id, rating, contract_price, content, created_at, meeting_status, is_approved')
      .eq('salesperson_id', id)
      .eq('is_approved', true)
      .order('created_at', { ascending: false })
    if (data) {
      setReviews(data.filter((r: any) => r.id !== ownData?.id))
    }
  }

  useEffect(() => {
    const supabase = createClient()

    const load = async () => {
      const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
      const SUPA_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

      // Step1: 公開データとstatsをanonキーで直接fetch（Supabaseクライアントの認証キューを迂回）
      const [publicResult, statsResult] = await Promise.allSettled([
        fetch(`${SUPA_URL}/rest/v1/safe_salesperson_profiles?select=*&id=eq.${id}`, {
          headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` },
        }).then(r => r.ok ? r.json().then((arr: any[]) => arr[0] ?? null) : null),
        fetch(`${SUPA_URL}/rest/v1/rpc/get_salesperson_review_stats`, {
          method: 'POST',
          headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ p_salesperson_id: id }),
        }).then(r => r.ok ? r.json() : null),
      ])

      if (publicResult.status === 'fulfilled' && publicResult.value) {
        setAgent(publicResult.value)
      }
      if (statsResult.status === 'fulfilled' && statsResult.value) {
        setReviewStats(statsResult.value)
      }

      // Step2: 認証チェック（公開データ表示後に非同期で実行）
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return
        setUser(user)

        const { data: ownProfile } = await supabase
          .from('salesperson_profiles').select('id').eq('user_id', user.id).maybeSingle()
        if (ownProfile && ownProfile.id !== id && !isPreview) {
          router.replace('/salesperson/dashboard')
          return
        }

        const { data: fullArr, error: fullError } = await supabase
          .rpc('get_unlocked_salesperson_profile', { p_agent_id: id as string })
        if (fullError) console.error('[salesperson detail] get_unlocked_salesperson_profile error:', fullError)
        const full = (fullArr && fullArr.length > 0) ? fullArr[0] : null

        if (!full && searchParams.get('autoUnlock') === '1') {
          setShowConfirmModal(true)
          if (typeof window !== 'undefined') {
            const url = new URL(window.location.href)
            url.searchParams.delete('autoUnlock')
            window.history.replaceState({}, '', url.pathname + url.search + url.hash)
          }
        }

        if (full) {
          setUnlockedData(full)
          await fetchReviews(supabase, user.id)

          const [{ data: anonData }, { data: myPhaseData }] = await Promise.all([
            supabase
              .from('anonymous_reviews')
              .select('id, rating, content, phase, source, created_at')
              .eq('salesperson_id', id)
              .eq('status', 'visible')
              .order('created_at', { ascending: false }),
            supabase.rpc('get_my_submitted_phases', { p_salesperson_id: id }),
          ])
          if (anonData) setAllAnonReviews(anonData)
          if (myPhaseData) {
            setUserSubmittedPhases(
              (myPhaseData as { phase: string; review_id: string }[])
                .filter((r) => r.phase !== 'pre_contract')
                .map((r) => r.phase)
            )
            setMyReviewIds(new Set((myPhaseData as { phase: string; review_id: string }[]).map((r) => r.review_id)))
          }
        }

        const { data: fav } = await supabase
          .from('favorites').select('id').eq('user_id', user.id).eq('salesperson_id', id).maybeSingle()
        setIsFavorited(!!fav)
      } catch {
        // 認証チェック失敗は無視（公開データは既に表示済み）
      }
    }

    load()
  }, [id])

  const handleFavoriteToggle = async () => {
    if (!user || favoriteLoading) return
    setFavoriteLoading(true)
    const supabase = createClient()
    if (isFavorited) {
      await supabase.from('favorites').delete().eq('user_id', user.id).eq('salesperson_id', id)
      setIsFavorited(false)
    } else {
      await supabase.from('favorites').insert({ user_id: user.id, salesperson_id: id })
      setIsFavorited(true)
    }
    setFavoriteLoading(false)
  }

  const handleUnlockClick = () => {
    if (!user) {
      router.push(`/auth/login?redirect=${encodeURIComponent(`/salesperson/${id}?autoUnlock=1`)}`)
      return
    }
    setShowConfirmModal(true)
  }

  const handleOffer = async () => {
    if (!user) return
    setPaying(true)
    setPayError('')
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/create-checkout-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ salesperson_id: id }),
      })
      const { url, error } = await res.json()
      if (url) {
        window.location.href = url
      } else {
        console.error(error)
        setPayError('決済ページへの遷移に失敗しました。もう一度お試しください。')
      }
    } catch (e) {
      console.error(e)
      setPayError('通信エラーが発生しました。')
    } finally {
      setPaying(false)
    }
  }

  const handleOfferSubmit = async () => {
    if (!offerMessage.trim() || !offerName.trim()) return
    setOfferSending(true)
    setOfferError('')
    try {
      const res = await fetch('/api/offers/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salesperson_id: id,
          area: offerArea || null,
          timing: offerTiming || null,
          message: offerMessage.trim(),
          contact_name: offerName.trim(),
        }),
      })
      if (!res.ok) { const j = await res.json(); throw new Error(j.error ?? '送信失敗') }
      setOfferDone(true)
    } catch (e: any) {
      setOfferError(e.message ?? '送信に失敗しました。もう一度お試しください。')
    } finally {
      setOfferSending(false)
    }
  }

  if (!agent) return (
    <div className="min-h-screen bg-stone-100">
      <Header backButton />
      <div className="max-w-2xl mx-auto px-6 py-8 space-y-4 animate-pulse">
        <div className="bg-white rounded-2xl p-8 space-y-4">
          <div className="flex gap-4">
            <div className="w-16 h-16 rounded-full bg-stone-200 shrink-0" />
            <div className="flex-1 space-y-2 pt-1">
              <div className="h-3 w-24 bg-stone-200 rounded" />
              <div className="h-5 w-40 bg-stone-200 rounded" />
              <div className="h-3 w-20 bg-stone-200 rounded" />
            </div>
          </div>
          <div className="h-24 bg-stone-100 rounded-xl" />
        </div>
        <div className="bg-white rounded-2xl p-8 h-32 bg-stone-100 rounded-xl" />
      </div>
    </div>
  )

  // ownReview は state で管理。reviews は他人の承認済み口コミのみを格納している

  return (
    <main className="min-h-screen bg-stone-100">
      <Header backButton />

      {/* 開示確認モーダル */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 overflow-y-auto py-8">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-5 my-auto">
            <div>
              <p className="text-lg font-bold text-gray-800">この営業担当者への相談を開始します</p>
              <p className="text-sm text-orange-500 font-semibold mt-1">利用料金：1,000円（税込）</p>
            </div>

            <div className="bg-stone-50 rounded-xl p-4">
              <p className="text-xs font-medium text-gray-500 mb-2">利用開始後にできること</p>
              <ul className="space-y-1.5 text-sm text-gray-700">
                <li className="flex items-start gap-2"><span className="text-orange-400 mt-0.5">✓</span>登録されている氏名の確認</li>
                <li className="flex items-start gap-2"><span className="text-orange-400 mt-0.5">✓</span>詳細プロフィール・自己紹介の閲覧</li>
                <li className="flex items-start gap-2"><span className="text-orange-400 mt-0.5">✓</span>公開中の口コミ全文の閲覧</li>
                <li className="flex items-start gap-2"><span className="text-orange-400 mt-0.5">✓</span>この営業担当者への相談リクエスト送信</li>
              </ul>
              <p className="text-xs text-gray-400 mt-3">利用開始後も、相談リクエストを送るかどうかは自由に判断できます。</p>
            </div>

            <div className="space-y-2 text-xs text-gray-500 leading-relaxed">
              <p>ERABERUは、担当者選びと相談開始のための情報・機能を提供するサービスです。相談への返信、面談や商談の成立、契約、建築結果などを保証するものではありません。</p>
              <p className="text-amber-600">デジタルコンテンツおよび相談機能の利用開始後は、お客様都合による返金をお受けできません。</p>
              <div className="flex gap-3 pt-1">
                <a href="/terms" className="text-gray-400 hover:text-gray-600 underline">利用規約</a>
                <a href="/privacy" className="text-gray-400 hover:text-gray-600 underline">プライバシーポリシー</a>
                <a href="/commercial-transactions" className="text-gray-400 hover:text-gray-600 underline">特定商取引法に基づく表記</a>
              </div>
            </div>

            {payError && <p className="text-red-500 text-xs">{payError}</p>}

            <div className="flex flex-col gap-2 pt-1">
              <button
                onClick={handleOffer}
                disabled={paying}
                className="w-full bg-orange-500 hover:bg-orange-400 disabled:bg-orange-300 text-white font-bold py-4 rounded-xl transition text-base"
              >
                {paying ? '決済ページへ移動中...' : '1,000円で利用を開始する'}
              </button>
              <button
                onClick={() => setShowConfirmModal(false)}
                className="w-full text-gray-500 hover:text-gray-700 py-2 text-sm transition"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      {isPreview && (
        <div className="bg-orange-500 px-6 py-3 flex items-center justify-between">
          <p className="text-white text-xs font-medium">👁️ プレビューモード：施主（未開示）の視点で表示しています</p>
          <Link href="/salesperson/dashboard?tab=preview" className="text-white text-xs underline">ダッシュボードに戻る</Link>
        </div>
      )}

      <div className="max-w-2xl mx-auto px-6 py-8 space-y-4">

        {/* プロフィールカード */}
        <div className="bg-stone-50 rounded-2xl shadow-sm border border-stone-200 p-8">

          {/* アバター・名前・会社 */}
          <div className="flex items-start justify-between mb-5">
            <div className="flex items-start gap-4">
              <div className="w-16 h-16 rounded-full overflow-hidden bg-gray-100 flex items-center justify-center text-3xl shrink-0">
                {unlockedData && agent.profile_image_url
                  ? <img src={agent.profile_image_url} alt="" className="w-full h-full object-cover" />
                  : '👤'}
              </div>
              <div>
                {unlockedData && (
                  <p className="text-lg font-bold text-gray-800 leading-tight">
                    {unlockedData.family_name && unlockedData.given_name
                      ? `${unlockedData.family_name} ${unlockedData.given_name}`
                      : unlockedData.real_name}
                  </p>
                )}
                <p className={`font-semibold ${unlockedData ? 'text-sm text-gray-500 mt-0.5' : 'text-gray-800 text-base'}`}>{agent.company_name}</p>
                {agent.department && (
                  <p className="text-xs text-gray-400 mt-0.5">{agent.department}</p>
                )}
              </div>
            </div>
            <div className="flex flex-col items-end gap-2 shrink-0">
              {agent.is_verified && (
                <span
                  className="text-sm bg-blue-50 text-blue-600 font-medium px-3 py-1 rounded-full cursor-help"
                  title="登録メールのドメインが、選択された会社の登録ドメインと一致しています。本人性・現在の在籍・権限・営業品質をERABERUが保証するものではありません。"
                >
                  ✓ 会社ドメイン一致
                </span>
              )}
              {user && (
                <button
                  onClick={handleFavoriteToggle}
                  disabled={favoriteLoading}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition-all ${
                    isFavorited
                      ? 'bg-rose-50 text-rose-500 border-rose-200 hover:bg-rose-100'
                      : 'bg-stone-50 text-stone-400 border-stone-200 hover:border-rose-200 hover:text-rose-400'
                  }`}
                >
                  <span>{isFavorited ? '♥' : '♡'}</span>
                  <span>{isFavorited ? 'お気に入り済み' : 'お気に入り'}</span>
                </button>
              )}
            </div>
          </div>

          {/* 星評価・口コミ件数（優先表示） */}
          {reviewStats && reviewStats.total > 0 && (
            <div className="mb-5">
              {reviewStats.avg_rating !== null ? (
                <div className="flex items-center gap-2">
                  <span className="text-amber-400 text-base">{'★'.repeat(Math.round(reviewStats.avg_rating))}{'☆'.repeat(5 - Math.round(reviewStats.avg_rating))}</span>
                  <span className="text-sm font-semibold text-gray-700">{reviewStats.avg_rating} / 5.0</span>
                  <span className="text-xs text-gray-400">口コミ {reviewStats.visible}件</span>
                </div>
              ) : (
                <p className="text-xs text-gray-400">口コミ {reviewStats.visible}件</p>
              )}
            </div>
          )}

          {/* AIによる紹介文 */}
          {agent.ai_summary ? (() => {
            const ai = agent.ai_summary as { summary: string; goodMatch: string[]; communicationStyle: string; strengths: string[] }
            return (
              <div className="bg-purple-50 border border-purple-100 rounded-xl p-4 space-y-3 text-sm mb-5">
                <div className="flex items-center gap-1.5">
                  <span className="text-purple-500">✨</span>
                  <p className="text-xs font-bold text-purple-600">AIによる紹介文</p>
                </div>
                <p className="text-gray-700 leading-relaxed">{ai.summary}</p>
                {ai.goodMatch?.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-gray-400 mb-1.5">相性がよさそうな方</p>
                    <div className="flex flex-wrap gap-1.5">
                      {ai.goodMatch.map((m, i) => (
                        <span key={i} className="text-xs bg-white text-purple-600 border border-purple-200 px-2.5 py-1 rounded-full">{m}</span>
                      ))}
                    </div>
                  </div>
                )}
                {ai.communicationStyle && (
                  <div>
                    <p className="text-xs font-medium text-gray-400 mb-1">会話スタイル</p>
                    <p className="text-gray-600 leading-relaxed">{ai.communicationStyle}</p>
                  </div>
                )}
                {ai.strengths?.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-gray-400 mb-1.5">得意なサポート</p>
                    <ul className="space-y-1">
                      {ai.strengths.map((s, i) => (
                        <li key={i} className="text-gray-600 flex items-start gap-1.5"><span className="text-purple-400 mt-0.5">・</span>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="text-xs text-gray-300 pt-1">※ プロフィール情報をもとにAIが生成した紹介文です</p>
              </div>
            )
          })() : (
            <div className="bg-purple-50 border border-purple-100 rounded-xl p-4 mb-5">
              <div className="flex items-center gap-1.5">
                <span className="text-purple-500">✨</span>
                <p className="text-xs font-bold text-purple-600">AIによる紹介文</p>
                <span className="text-xs bg-purple-100 text-purple-400 px-2 py-0.5 rounded-full ml-auto">準備中</span>
              </div>
              <p className="text-sm text-gray-400 leading-relaxed mt-2">
                口コミ・自己紹介・実績をもとにAIが生成した紹介文がここに表示されます。
              </p>
            </div>
          )}

          {/* 補足情報 */}
          <div className="space-y-4">
            {(agent.core_city || (agent.available_prefectures ?? []).length > 0) && (
              <div>
                <p className="text-xs text-gray-400 mb-1">活動エリア</p>
                {agent.core_city && (
                  <p className="text-gray-800 text-sm mb-1">📍 コアエリア: {agent.core_city}</p>
                )}
                {(agent.available_prefectures ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {agent.available_prefectures.map((p: string) => (
                      <span key={p} className="text-xs bg-stone-100 text-stone-600 px-2 py-0.5 rounded-full">{p}</span>
                    ))}
                  </div>
                )}
              </div>
            )}
            {(agent.specialty_styles ?? []).length > 0 && (
              <div>
                <p className="text-xs text-gray-400 mb-2">カテゴリ</p>
                <div className="flex flex-wrap gap-2">
                  {agent.specialty_styles.map((s: string) => (
                    <span key={s} className="text-sm bg-orange-50 text-orange-500 px-3 py-1 rounded-full border border-orange-100">{s}</span>
                  ))}
                </div>
              </div>
            )}
            {(agent.specialties ?? []).length > 0 && (
              <div>
                <p className="text-xs text-gray-400 mb-2">得意分野（本人選択）</p>
                <div className="flex flex-wrap gap-2">
                  {agent.specialties.map((s: string) => (
                    <span key={s} className="text-xs bg-amber-50 text-amber-700 px-2.5 py-1 rounded-full border border-amber-200">{s}</span>
                  ))}
                </div>
              </div>
            )}
            {(agent.qualifications ?? []).length > 0 && (
              <div>
                <p className="text-xs text-gray-400 mb-2">所持資格</p>
                <div className="flex flex-wrap gap-2">
                  {agent.qualifications.map((q: string) => (
                    <span key={q} className="text-sm bg-blue-50 text-blue-500 px-3 py-1 rounded-full border border-blue-100">{q}</span>
                  ))}
                </div>
              </div>
            )}
            {(() => {
              const styles: Record<string, number> = agent.sales_styles ?? {}
              const hasStyles = SALES_STYLE_AXES.some(({ key }) => styles[key] !== undefined)
              if (!hasStyles) return null
              return (
                <div>
                  <p className="text-xs text-gray-400 mb-3">会話スタイル（本人評価）</p>
                  <div className="space-y-3">
                    {SALES_STYLE_AXES.map(({ key, left, right }) => {
                      const val = styles[key] ?? 3
                      const pct = ((val - 1) / 4) * 100
                      return (
                        <div key={key}>
                          <div className="flex justify-between text-xs text-stone-400 mb-2">
                            <span>{left}</span>
                            <span>{right}</span>
                          </div>
                          <div className="relative h-5 flex items-center">
                            <div className="absolute inset-x-0 h-1.5 rounded-full bg-stone-200" />
                            <div
                              className="absolute text-orange-400 leading-none -translate-x-1/2 text-base"
                              style={{ left: `${pct}%` }}
                            >★</div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })()}
            {reviewStats && reviewStats.total > 0 && (
              <div>
                <p className="text-xs text-gray-400 mb-1">口コミ公開率</p>
                <div className="flex items-center gap-3">
                  <div className="flex-1 bg-stone-200 rounded-full h-2">
                    <div
                      className="bg-green-400 h-2 rounded-full transition-all"
                      style={{ width: `${reviewStats.rate ?? 0}%` }}
                    />
                  </div>
                  <span className="text-sm font-semibold text-gray-700">{reviewStats.rate ?? 0}%</span>
                  <span className="text-xs text-gray-400">（{reviewStats.visible}/{reviewStats.total}件）</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 開示済み or ロック */}
        {unlockedData ? (
          <>
          <div className="bg-stone-50 rounded-2xl shadow-sm border border-green-200 p-8">
            <div className="flex items-center gap-2 mb-5">
              <span className="text-green-600">🔓</span>
              <p className="text-sm font-bold text-green-600">開示済み情報</p>
            </div>
            <div className="space-y-5">
              <div>
                <p className="text-xs text-gray-400 mb-1">氏名</p>
                <p className="text-gray-800 font-semibold">
                  {unlockedData.family_name && unlockedData.given_name
                    ? `${unlockedData.family_name} ${unlockedData.given_name}`
                    : unlockedData.real_name}
                </p>
              </div>
              {unlockedData.bio && (
                <div>
                  <p className="text-xs text-gray-400 mb-1">自己紹介</p>
                  <p className="text-sm text-gray-700 leading-relaxed">{unlockedData.bio}</p>
                </div>
              )}
              <div className="flex gap-6">
                {unlockedData.contract_count !== null && (
                  <div>
                    <p className="text-xs text-gray-400 mb-1">累計成約数</p>
                    <p className="text-gray-800 font-semibold">{unlockedData.contract_count}棟</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 口コミ一覧（全フェーズ統合） */}
          <div className="bg-stone-50 rounded-2xl shadow-sm border border-stone-200 p-6">
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-sm font-bold text-gray-700">口コミ</p>
                <p className="text-xs text-gray-400 mt-0.5">{allAnonReviews.length}件</p>
              </div>
              <div className="flex items-center gap-2">
                {userSubmittedPhases.length < 3 && (
                  <Link
                    href={`/review/write/${id}`}
                    className="text-xs text-orange-500 hover:text-orange-400 border border-orange-200 rounded-lg px-3 py-1.5 transition"
                  >
                    口コミを書く
                  </Link>
                )}
                <select
                  value={phaseFilter}
                  onChange={(e) => setPhaseFilter(e.target.value)}
                  className="text-xs border border-stone-200 rounded-lg px-2 py-1.5 bg-white text-gray-600 focus:outline-none focus:ring-1 focus:ring-orange-300"
                >
                  <option value="all">全フェーズ</option>
                  <option value="pre_contract">契約前</option>
                  <option value="post_contract">契約後</option>
                  <option value="after_start">着工後</option>
                  <option value="after_handover">引渡後</option>
                </select>
              </div>
            </div>

            <p className="text-xs text-gray-400 mb-4 leading-relaxed">
              口コミは投稿者の体験に基づく主観的な情報を含みます。ERABERUは口コミの正確性・完全性・最新性・担当者の対応品質を保証するものではありません。
            </p>

            {(() => {
              const filtered = phaseFilter === 'all'
                ? allAnonReviews
                : allAnonReviews.filter((r) => r.phase === phaseFilter)
              if (filtered.length === 0) {
                return <p className="text-sm text-gray-400">口コミはありません</p>
              }
              return (
                <div className="space-y-3">
                  {filtered.map((r) => {
                    const meta = PHASE_META[r.phase] ?? PHASE_META['pre_contract']
                    return (
                      <div key={r.id} className={`rounded-xl border p-4 ${meta.bg} ${meta.border}`}>
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full bg-white border ${meta.border} ${meta.text}`}>
                            {meta.label}
                          </span>
                          {myReviewIds.has(r.id) && (
                            <span className="text-xs bg-orange-50 text-orange-500 border border-orange-200 px-2 py-0.5 rounded-full">あなたの口コミ</span>
                          )}
                          {r.rating && (
                            <span className="text-xs text-amber-500 ml-auto">
                              {'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-700 leading-relaxed">{r.content}</p>
                        <p className="text-xs text-gray-400 mt-1.5">
                          {new Date(r.created_at).toLocaleDateString('ja-JP')}
                        </p>
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </div>

          {/* 口コミ一覧 */}
          <div className="bg-stone-50 rounded-2xl shadow-sm border border-stone-200 p-6">
            <p className="text-sm font-bold text-gray-700 mb-4">口コミ</p>

            {/* 自分の口コミ（承認状況付き） */}
            {ownReview && (
              <div className="mb-4 p-4 rounded-xl border border-dashed border-orange-200 bg-orange-50">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-orange-600">あなたの口コミ</p>
                  {ownReview.is_approved
                    ? <span className="text-xs bg-green-100 text-green-600 px-2 py-0.5 rounded-full">公開中</span>
                    : <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">確認中</span>
                  }
                </div>
                {ownReview.rating && (
                  <p className="text-sm text-amber-400 mb-1">
                    {'★'.repeat(ownReview.rating)}{'☆'.repeat(5 - ownReview.rating)}
                  </p>
                )}
                {ownReview.meeting_status && (
                  <p className="text-xs text-gray-400 mb-1">📋 {ownReview.meeting_status}</p>
                )}
                {ownReview.contract_price && (
                  <p className="text-xs text-gray-400 mb-1">
                    成約価格: {(ownReview.contract_price / 10000).toLocaleString()}万円
                  </p>
                )}
                <p className="text-sm text-gray-700 leading-relaxed">{ownReview.content}</p>
                <p className="text-xs text-gray-400 mt-2">
                  {new Date(ownReview.created_at).toLocaleDateString('ja-JP')}
                </p>
              </div>
            )}

            {/* 他ユーザーの承認済み口コミ */}
            {reviews.length === 0 && !ownReview && (
              <p className="text-sm text-gray-400">まだ口コミがありません</p>
            )}
            {reviews.length > 0 && (
              <div className="space-y-4">
                {reviews.map((r, i) => (
                  <div key={i} className="border-b border-stone-100 pb-4 last:border-0 last:pb-0">
                    {r.rating && (
                      <p className="text-sm text-amber-400 mb-1">
                        {'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}
                      </p>
                    )}
                    {r.meeting_status && (
                      <p className="text-xs text-gray-400 mb-1">📋 {r.meeting_status}</p>
                    )}
                    {r.contract_price && (
                      <p className="text-xs text-gray-400 mb-1">
                        成約価格: {(r.contract_price / 10000).toLocaleString()}万円
                      </p>
                    )}
                    <p className="text-sm text-gray-700 leading-relaxed">{r.content}</p>
                    <p className="text-xs text-gray-400 mt-2">
                      {new Date(r.created_at).toLocaleDateString('ja-JP')}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* 口コミ投稿案内 */}
            <div className="mt-5 pt-5 border-t border-stone-100">
              <p className="text-xs text-gray-400 leading-relaxed">
                この担当者とすでに家づくりを進めている方は、専用QRまたは
                <Link href="/mypage" className="text-orange-500 hover:underline mx-0.5">マイページ</Link>
                から口コミを投稿できます。
              </p>
            </div>
          </div>
          </>
        ) : (
          <>
          <div className="bg-stone-50 rounded-2xl shadow-sm border border-dashed border-gray-200 p-8 relative overflow-hidden">
            <div className="absolute inset-0 bg-stone-50/60 backdrop-blur-[2px] z-10 flex flex-col items-center justify-center gap-2">
              <span className="text-3xl">🔒</span>
              <p className="text-sm font-bold text-gray-600">プロフィール開示後に閲覧できます</p>
              <p className="text-xs text-gray-400">口コミ・詳細情報は有料開示後に表示されます</p>
            </div>
            <div className="space-y-4 opacity-30 select-none">
              <div>
                <p className="text-xs text-gray-400 mb-1">氏名</p>
                <p className="text-gray-800 font-semibold">██ ██</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">自己紹介</p>
                <p className="text-sm text-gray-600">████████████████████████████████████████</p>
                <p className="text-sm text-gray-600 mt-1">████████████████████████</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">経験年数 / 成約数</p>
                <p className="text-sm text-gray-600">██年 / ██棟</p>
              </div>
            </div>
          </div>

          </>
        )}

        {/* 詳細開示CTA（未開示の場合のみ） */}
        {!unlockedData && (
          <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-6">
            <p className="text-gray-800 font-bold text-base mb-1">この営業担当者への相談を始める</p>
            <p className="text-gray-500 text-sm mb-1">氏名・詳細プロフィール・公開中の口コミを確認し、この営業担当者へ相談リクエストを送れるようになります。</p>
            <p className="text-gray-400 text-xs mb-5">利用開始後も、相談を送るかどうかは自由に判断できます。</p>

            {payError && <p className="text-red-500 text-xs mb-3">{payError}</p>}
            <button
              onClick={handleUnlockClick}
              className="w-full bg-orange-500 hover:bg-orange-400 text-white font-bold py-4 rounded-xl transition text-base"
            >
              相談を開始する
            </button>
            <p className="text-center text-xs text-gray-400 mt-2">利用料金 1,000円（税込）</p>
          </div>
        )}

        {/* オファー（相談）フォーム：開示後のみ表示 */}
        {unlockedData && (
        <div className="bg-stone-50 rounded-2xl shadow-sm border border-stone-200 p-6">
          <p className="text-sm font-bold text-gray-800 mb-1">この営業担当者に相談する</p>
          <p className="text-xs text-gray-500 mb-4">検討エリア・時期・相談内容を送ると、担当者側に届きます。</p>

          {offerDone ? (
            <div className="text-center py-6 space-y-2">
              <span className="text-3xl">✅</span>
              <p className="text-sm font-bold text-gray-700">相談リクエストを送信しました</p>
              <p className="text-xs text-gray-400">担当者側で内容を確認し、ご連絡差し上げます。</p>
            </div>
          ) : !showOfferForm ? (
            <button
              onClick={() => setShowOfferForm(true)}
              className="w-full bg-teal-500 hover:bg-teal-400 text-white font-bold py-3.5 rounded-xl text-sm transition"
            >
              相談リクエストを送る
            </button>
          ) : (
            <div className="space-y-4">
              {!agent.is_verified && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                  <p className="text-xs text-amber-700 leading-relaxed">
                    ⚠️ この営業担当者は、会社指定ドメインによる所属確認が完了していません。表示されている所属会社・在籍状況については、打ち合わせ前にご自身でもご確認ください。
                  </p>
                </div>
              )}
              <div>
                <label className="text-xs text-gray-500 font-medium mb-1 block">検討エリア（任意）</label>
                <input
                  type="text" value={offerArea} onChange={(e) => setOfferArea(e.target.value)}
                  placeholder="例: 横浜市青葉区"
                  className="w-full text-sm text-gray-800 bg-white border border-stone-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-teal-200 placeholder:text-gray-400"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 font-medium mb-1.5 block">建築予定時期（任意）</label>
                <div className="flex flex-wrap gap-2">
                  {OFFER_TIMINGS.map((t) => (
                    <button key={t} type="button"
                      onClick={() => setOfferTiming(offerTiming === t ? '' : t)}
                      className={`text-xs px-3 py-1.5 rounded-full border transition ${offerTiming === t ? 'bg-teal-500 text-white border-teal-500' : 'bg-white text-gray-500 border-stone-200 hover:border-teal-300'}`}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="flex justify-between items-baseline mb-1">
                  <label className="text-xs text-gray-500 font-medium">相談内容 <span className="text-red-400">*</span></label>
                  <span className="text-xs text-gray-400">{offerMessage.length}/50文字</span>
                </div>
                <textarea
                  value={offerMessage} onChange={(e) => setOfferMessage(e.target.value)}
                  placeholder="家づくりの希望、不安なこと、相談したいことを自由に書いてください"
                  rows={4}
                  maxLength={50}
                  className="w-full text-sm text-gray-800 bg-white border border-stone-200 rounded-xl px-4 py-3 resize-none focus:outline-none focus:ring-2 focus:ring-teal-200 placeholder:text-gray-400"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 font-medium mb-1 block">
                  お名前 <span className="text-red-400">*</span>
                </label>
                <input
                  type="text" value={offerName} onChange={(e) => setOfferName(e.target.value)}
                  placeholder="山田 太郎"
                  maxLength={50}
                  className="w-full text-sm text-gray-800 bg-white border border-stone-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-teal-200 placeholder:text-gray-400"
                />
              </div>
              <div className="bg-stone-50 border border-stone-200 rounded-xl px-4 py-3">
                <p className="text-xs text-gray-500">連絡先にはログイン中の認証済みメールアドレスが使用されます。</p>
              </div>
              {offerError && <p className="text-sm text-red-500">{offerError}</p>}
              <div className="flex gap-3">
                <button
                  type="button" onClick={() => setShowOfferForm(false)}
                  className="flex-1 bg-stone-100 hover:bg-stone-200 text-gray-600 font-bold py-3 rounded-xl text-sm transition"
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  onClick={handleOfferSubmit}
                  disabled={offerSending || !offerMessage.trim() || !offerName.trim()}
                  className="flex-1 bg-teal-500 hover:bg-teal-400 disabled:bg-gray-200 disabled:text-gray-400 text-white font-bold py-3 rounded-xl text-sm transition"
                >
                  {offerSending ? '送信中...' : '相談リクエストを送る'}
                </button>
              </div>
            </div>
          )}
        </div>
        )}

      </div>
    </main>
  )
}

export default function SalespersonDetail() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-stone-100">
        <Header backButton />
        <div className="max-w-2xl mx-auto px-6 py-8 space-y-4 animate-pulse">
          <div className="bg-white rounded-2xl p-8 space-y-4">
            <div className="flex gap-4">
              <div className="w-16 h-16 rounded-full bg-stone-200 shrink-0" />
              <div className="flex-1 space-y-2 pt-1">
                <div className="h-3 w-24 bg-stone-200 rounded" />
                <div className="h-5 w-40 bg-stone-200 rounded" />
              </div>
            </div>
            <div className="h-24 bg-stone-100 rounded-xl" />
          </div>
        </div>
      </div>
    }>
      <SalespersonDetailContent />
    </Suspense>
  )
}
