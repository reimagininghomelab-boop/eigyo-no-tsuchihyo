'use client'
import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import Header from '@/components/Header'

// ─── 型 ───────────────────────────────────────────────────────────
const SALES_STYLE_AXES = [
  { key: 'listening_proposing', left: '傾聴型', right: '提案型', label: '相談の進め方' },
  { key: 'numbers_feeling', left: '数字で説明', right: '感覚で説明', label: '説明の傾向' },
] as const

const PHASE_LABELS: Record<string, string> = {
  pre_contract: '契約前',
  post_contract: '契約後',
  after_start: '着工後',
  after_handover: '引渡後',
}

const KEYWORD_PATTERNS = [
  { label: '説明がわかりやすい', re: /わかりやす|説明.*丁寧|丁寧.*説明/ },
  { label: '話をよく聞いてくれる', re: /聞いてくれ|ヒアリング|話を聞/ },
  { label: '押しつけ感が少ない', re: /押しつけ|無理に|強引|押し付け/ },
  { label: '返信が早い', re: /返信.*早|連絡.*早|レスポンス.*早|早い.*返信/ },
  { label: '比較しやすい提案', re: /比較|選択肢|複数の候補|他社との/ },
  { label: '引渡し後も相談しやすい', re: /引渡|アフター|入居後|竣工後/ },
  { label: '安心して任せられる', re: /安心|信頼|頼れる|任せ/ },
  { label: '提案が丁寧', re: /提案.*丁寧|丁寧.*提案|細かく提案/ },
]

function extractKeywords(reviews: { content: string }[]): string[] {
  if (reviews.length === 0) return []
  const allText = reviews.map((r) => r.content).join(' ')
  return KEYWORD_PATTERNS.filter(({ re }) => re.test(allText)).map(({ label }) => label).slice(0, 5)
}

type AISummary = { summary?: string; goodMatch?: string[]; communicationStyle?: string; strengths?: string[] }
type AiMatchResult = { agent_id: string; score: number; match_reason: string }

function formatMatchCopy(text: string): string {
  if (!text) return text
  return text.endsWith('方') ? `${text}へ` : text
}

// ─── スタイルフィルター ────────────────────────────────────────────
const STYLE_QUADRANT: Record<string, string> = {
  'empathy-support': 'tl',
  'sensibility-proposal': 'tr',
  'organize-support': 'bl',
  'strategy-proposal': 'br',
}

const QUADRANT_LABEL: Record<string, string> = {
  'tl': '共感伴走タイプ',
  'tr': '感性提案タイプ',
  'bl': '整理伴走タイプ',
  'br': '戦略提案タイプ',
}

function agentQuadrantKey(agent: any): string | null {
  const ss = agent.sales_styles as Record<string, number> | null
  if (!ss) return null
  const lp = ss.listening_proposing ?? 3
  const nf = ss.numbers_feeling ?? 3
  if (lp < 3.5 && nf > 3.5) return 'tl'
  if (lp >= 3.5 && nf > 3.5) return 'tr'
  if (lp < 3.5 && nf <= 3.5) return 'bl'
  return 'br'
}

// ─── ログインゲートモーダル ──────────────────────────────────────────
function LoginGateModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-teal-500">🔒</span>
          <h3 className="text-base font-bold text-gray-800">ログインが必要です</h3>
        </div>
        <p className="text-sm text-gray-600 leading-relaxed mb-5">
          名前・顔写真など、個人が特定できる情報の開示にはログインが必要です。
          口コミ傾向の確認は登録なしでご利用いただけます。
        </p>
        <div className="space-y-2">
          <Link href="/auth/login" className="block w-full bg-teal-500 hover:bg-teal-400 text-white font-bold py-3 rounded-xl text-sm text-center transition">
            ログインして開示する
          </Link>
          <Link href="/auth/login?mode=signup" className="block w-full border border-teal-200 text-teal-600 font-semibold py-3 rounded-xl text-sm text-center hover:bg-teal-50 transition">
            無料登録する
          </Link>
          <button onClick={onClose} className="w-full text-gray-400 hover:text-gray-600 py-2 text-sm transition">戻る</button>
        </div>
      </div>
    </div>
  )
}

// ─── AIチャットモーダル ──────────────────────────────────────────────
const AI_CHAT_GREETING = 'こんにちは！どんな住宅営業マンをお探しですか？エリアや希望、不安なことなど、気軽に教えてください。'

function AiSearchModal({ onClose, onSearchComplete, agents }: {
  onClose: () => void
  onSearchComplete: (query: string, results: AiMatchResult[]) => void
  agents: any[]
}) {
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([
    { role: 'assistant', content: AI_CHAT_GREETING },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [phase, setPhase] = useState<'chat' | 'searching'>('chat')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, loading, phase])

  const runSearch = async (summary: string) => {
    setPhase('searching')
    try {
      const agentData = agents.slice(0, 30).map((a) => ({
        id: a.id, company_name: a.company_name, area_prefecture: a.area_prefecture,
        specialty_styles: a.specialty_styles,
        ai_summary: a.ai_summary ? { communicationStyle: a.ai_summary.communicationStyle, goodMatch: a.ai_summary.goodMatch } : undefined,
        bio: a.bio,
      }))
      const res = await fetch('/api/ai/match-agents', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: summary, agents: agentData }),
      })
      if (!res.ok) throw new Error()
      const data = await res.json()
      onSearchComplete(summary, data.results ?? [])
      onClose()
    } catch {
      setPhase('chat')
      setMessages((prev) => [...prev, { role: 'assistant', content: '候補の検索中にエラーが発生しました。もう一度お試しください。' }])
    }
  }

  const handleSend = async () => {
    if (!input.trim() || loading || phase === 'searching') return
    const userText = input.trim()
    setInput('')
    const newMessages = [...messages, { role: 'user' as const, content: userText }]
    setMessages(newMessages)
    setLoading(true)
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages }),
      })
      if (!res.ok) throw new Error()
      const data = await res.json()
      setMessages([...newMessages, { role: 'assistant', content: data.message }])
      setLoading(false)
      if (data.ready) setTimeout(() => runSearch(data.summary ?? userText), 600)
    } catch {
      setMessages([...newMessages, { role: 'assistant', content: 'エラーが発生しました。もう一度お試しください。' }])
      setLoading(false)
    }
  }

  const isBusy = loading || phase === 'searching'

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !isBusy) onClose() }}>
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl flex flex-col" style={{ height: 'min(540px, 88vh)' }}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-stone-100 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-base">✨</span>
            <h3 className="text-sm font-bold text-gray-800">AIに相談して探す</h3>
          </div>
          <button onClick={onClose} disabled={isBusy} className="text-gray-400 hover:text-gray-600 transition disabled:opacity-30 text-xl leading-none">×</button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {messages.map((msg, i) => (
            <div key={i} className={`flex items-end gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'assistant' && (
                <div className="w-6 h-6 rounded-full bg-orange-100 flex items-center justify-center shrink-0 mb-0.5">
                  <span className="text-xs leading-none">✨</span>
                </div>
              )}
              <div className={`max-w-[78%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${msg.role === 'user' ? 'bg-teal-500 text-white rounded-br-sm' : 'bg-stone-100 text-gray-800 rounded-bl-sm'}`}>
                {msg.content}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex items-end gap-2 justify-start">
              <div className="w-6 h-6 rounded-full bg-orange-100 flex items-center justify-center shrink-0 mb-0.5">
                <span className="text-xs leading-none">✨</span>
              </div>
              <div className="bg-stone-100 rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm text-gray-400">考え中...</div>
            </div>
          )}
          {phase === 'searching' && (
            <div className="text-center py-4 text-sm text-orange-600 font-medium">候補を検索中...</div>
          )}
          <div ref={bottomRef} />
        </div>
        <div className="px-4 pb-4 pt-2 border-t border-stone-100 shrink-0">
          <div className="flex gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
              disabled={isBusy}
              placeholder="希望や不安を自由に書いてください"
              rows={2}
              className="flex-1 text-sm text-gray-800 bg-white border border-stone-200 rounded-xl px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-orange-200 disabled:opacity-50 placeholder:text-gray-400"
            />
            <button onClick={handleSend} disabled={isBusy || !input.trim()}
              className="bg-orange-500 hover:bg-orange-400 disabled:bg-gray-200 text-white font-bold px-4 rounded-xl transition text-sm shrink-0">
              送信
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── 詳細パネル（PC右カラム） ────────────────────────────────────────
function DetailPanel({ agent, unlockedData, reviews, reviewsLoading, onViewContact }: {
  agent: any; unlockedData: any | null; reviews: any[]; reviewsLoading: boolean; onViewContact: (agentId: string) => void
}) {
  const ai = (agent.ai_summary ?? null) as AISummary | null
  const salesStyles = (agent.sales_styles ?? {}) as Record<string, number>

  const displayName = unlockedData
    ? (unlockedData.family_name && unlockedData.given_name ? `${unlockedData.family_name} ${unlockedData.given_name}` : unlockedData.real_name ?? '---')
    : (agent.name_initials ? `${agent.name_initials} さん` : '---')

  const consultationThemes: string[] = (agent.specialties ?? []).length > 0 ? agent.specialties : (ai?.strengths ?? [])
  const matchCopy = ai?.goodMatch?.[0] ? formatMatchCopy(ai.goodMatch[0]) : null
  const hasSourceInfo = (agent.specialty_styles ?? []).length > 0 || SALES_STYLE_AXES.some(({ key }) => salesStyles[key] !== undefined)
  const reviewKeywords = extractKeywords(reviews)
  const mostRecentDate = reviews[0] ? new Date(reviews[0].created_at).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long' }) : null

  return (
    <div className="space-y-4 pr-1">
      {/* 基本情報 */}
      <div className="bg-white rounded-2xl border border-stone-200 p-6">
        <div className="flex items-start gap-4">
          <div className="w-20 h-20 rounded-full overflow-hidden bg-stone-100 flex items-center justify-center shrink-0">
            {unlockedData && agent.profile_image_url ? <img src={agent.profile_image_url} alt="" className="w-full h-full object-cover" /> : <span className="text-4xl">👤</span>}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-400 mb-0.5">{agent.company_name}</p>
            <p className="text-xl font-bold text-gray-800">{displayName}</p>
            {agent.area_prefecture && <p className="text-sm text-gray-500 mt-1">📍 {agent.area_prefecture}</p>}
            {(agent.available_prefectures ?? []).length > 0 && (
              <p className="text-xs text-gray-400 mt-0.5">対応：{(agent.available_prefectures as string[]).join('・')}</p>
            )}
            {!unlockedData && <p className="text-xs text-stone-400 mt-1.5">🔒 氏名・顔写真・連絡先は開示後に表示</p>}
          </div>
        </div>
        {(matchCopy || ai?.communicationStyle) && (
          <div className="mt-5 pt-4 border-t border-stone-100">
            {matchCopy && <p className="text-sm font-semibold text-gray-700 mb-2 leading-snug">{matchCopy}</p>}
            {ai?.communicationStyle && <p className="text-sm text-gray-600 leading-relaxed">{ai.communicationStyle}</p>}
          </div>
        )}
        {((agent.specialty_styles ?? []).length > 0 || (agent.qualifications ?? []).length > 0) && (
          <div className="flex flex-wrap gap-1.5 mt-4">
            {(agent.specialty_styles as string[] ?? []).map((s: string) => (
              <span key={s} className="text-xs bg-teal-50 text-teal-700 border border-teal-100 px-2.5 py-1 rounded-full">{s}</span>
            ))}
            {(agent.qualifications as string[] ?? []).map((q: string) => (
              <span key={q} className="text-xs bg-slate-50 text-slate-600 border border-slate-200 px-2.5 py-1 rounded-full">{q}</span>
            ))}
          </div>
        )}
      </div>

      {/* AI紹介文 */}
      {ai?.summary && (
        <div className="bg-white rounded-2xl border border-stone-200 p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-teal-500 text-sm">✨</span>
            <p className="text-sm font-bold text-gray-700">AI紹介文</p>
          </div>
          <p className="text-sm text-gray-700 leading-relaxed line-clamp-4">{ai.summary}</p>
          <p className="text-xs text-gray-300 mt-3">※ プロフィール情報をもとにAIが生成した紹介文です</p>
        </div>
      )}

      {/* こんな方に合いそう */}
      {ai?.goodMatch && ai.goodMatch.length > 0 && (
        <div className="rounded-xl border border-amber-100 bg-amber-50/70 px-4 py-3">
          <p className="text-xs font-bold text-amber-700 mb-2">この方はこんな方に合いそう</p>
          <ul className="space-y-1">
            {ai.goodMatch.map((m, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-amber-800 leading-relaxed">
                <span className="text-amber-400 shrink-0 mt-0.5">・</span>{m}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 相談しやすいテーマ */}
      {consultationThemes.length > 0 && (
        <div className="bg-white rounded-2xl border border-stone-200 p-5">
          <p className="text-sm font-bold text-gray-700 mb-3">相談しやすいテーマ</p>
          <div className="flex flex-wrap gap-2">
            {consultationThemes.map((theme: string, i: number) => (
              <span key={i} className="text-xs bg-green-50 text-green-700 border border-green-100 px-3 py-1.5 rounded-xl">{theme}</span>
            ))}
          </div>
        </div>
      )}

      {/* 口コミ */}
      <div className="bg-white rounded-2xl border border-stone-200 p-5">
        <div className="flex items-baseline gap-3 mb-4">
          <p className="text-sm font-bold text-gray-700">口コミ・お客様の声</p>
          {!reviewsLoading && reviews.length > 0 && <span className="text-xs text-gray-400">{reviews.length}件</span>}
          {mostRecentDate && <span className="text-xs text-gray-400 ml-auto">直近：{mostRecentDate}</span>}
        </div>
        {reviewsLoading ? (
          <p className="text-sm text-gray-400">読み込み中...</p>
        ) : reviews.length === 0 ? (
          <p className="text-sm text-gray-400">まだ口コミはありません</p>
        ) : (
          <>
            {reviewKeywords.length > 0 && (
              <div className="mb-4">
                <p className="text-xs text-gray-400 mb-2">口コミで多い声</p>
                <div className="flex flex-wrap gap-1.5">
                  {reviewKeywords.map((k, i) => (
                    <span key={i} className="text-xs bg-stone-100 text-gray-600 px-2.5 py-1 rounded-full">· {k}</span>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-3">
              {reviews.slice(0, 3).map((r) => (
                <div key={r.id} className="bg-stone-50 rounded-xl p-4 border border-stone-100">
                  {r.phase && PHASE_LABELS[r.phase] && (
                    <span className="inline-block text-xs text-stone-500 border border-stone-200 bg-white px-2 py-0.5 rounded-full mb-2">
                      {PHASE_LABELS[r.phase]}
                    </span>
                  )}
                  <p className="text-sm text-gray-700 leading-relaxed line-clamp-3">「{r.content}」</p>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* 根拠情報 */}
      {hasSourceInfo && (
        <div className="bg-stone-50 rounded-2xl border border-stone-100 p-5">
          <p className="text-xs font-bold text-gray-400 mb-3">この紹介文のもとになった情報</p>
          <div className="space-y-2">
            {SALES_STYLE_AXES.map(({ key, left, right, label }) => {
              const val = salesStyles[key]
              if (val === undefined) return null
              return (
                <div key={key} className="flex items-center gap-2 text-xs text-gray-600">
                  <span className="text-gray-400 shrink-0 w-24">{label}：</span>
                  <span>{Number(val) <= 3 ? left : right}</span>
                </div>
              )
            })}
            {(agent.specialty_styles ?? []).length > 0 && (
              <div className="flex items-start gap-2 text-xs text-gray-600">
                <span className="text-gray-400 shrink-0 w-24">得意分野：</span>
                <span>{(agent.specialty_styles as string[]).join(' / ')}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* CTA */}
      <div className="bg-teal-50 rounded-2xl border border-teal-100 p-6">
        <p className="text-sm font-semibold text-gray-700 mb-1">{displayName}のプロフィールを確認する</p>
        <p className="text-xs text-gray-500 mb-4">口コミ全文・提案スタイルの詳細はプロフィールページでご覧いただけます</p>
        <div className="space-y-2">
          <Link href={`/salesperson/${agent.id}`}
            className="block w-full bg-teal-500 hover:bg-teal-400 text-white font-bold py-3.5 rounded-xl transition text-center text-sm">
            詳しく見る
          </Link>
          {!unlockedData && (
            <button onClick={() => onViewContact(agent.id)}
              className="block w-full bg-orange-500 hover:bg-orange-400 text-white font-bold py-3 rounded-xl transition text-sm">
              名前・連絡先を見る
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── 検索ページ本体（useSearchParams を使うので Suspense 内） ─────────
function SearchContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const styleParam = searchParams.get('style')
  const aiParam = searchParams.get('ai')

  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [agents, setAgents] = useState<any[]>([])
  const [unlockedMap, setUnlockedMap] = useState<Record<string, any>>({})
  const [keyword, setKeyword] = useState('')
  const [filterPrefecture, setFilterPrefecture] = useState('')
  const [filterSpecialty, setFilterSpecialty] = useState('')
  const [filterQualification, setFilterQualification] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('id'))
  const [selectedReviews, setSelectedReviews] = useState<any[]>([])
  const [reviewsLoading, setReviewsLoading] = useState(false)
  const [showAiModal, setShowAiModal] = useState(false)
  const [showLoginGate, setShowLoginGate] = useState(false)
  const [aiMode, setAiMode] = useState<{ query: string; results: AiMatchResult[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [retryCount, setRetryCount] = useState(0)
  // ログイン施主の接点済み営業（オファー or 口コミ）
  const [contactedIds, setContactedIds] = useState<Set<string>>(new Set())
  // オファー済みで口コミ未投稿の営業（バナー表示用）
  const [pendingReviewCount, setPendingReviewCount] = useState(0)
  const [showContactedSection, setShowContactedSection] = useState(false)
  // 口コミ促進バナーを閉じたか
  const [bannerDismissed, setBannerDismissed] = useState(false)

  // スタイルフィルター名
  const activeStyleLabel = styleParam ? (QUADRANT_LABEL[STYLE_QUADRANT[styleParam] ?? ''] ?? null) : null

  const handleAiSearchComplete = (query: string, results: AiMatchResult[]) => {
    setAiMode({ query, results })
  }

  const handleViewContact = (agentId: string) => {
    if (!isLoggedIn) setShowLoginGate(true)
    else router.push(`/salesperson/${agentId}`)
  }

  const fetchReviewsForAgent = useCallback(async (agentId: string) => {
    setReviewsLoading(true)
    setSelectedReviews([])
    const supabase = createClient()
    const { data } = await supabase
      .from('anonymous_reviews')
      .select('id, content, phase, created_at')
      .eq('salesperson_id', agentId)
      // 施主向け本文表示は3軸で判定（旧statusは意味判断に使わない）
      .eq('display_state', 'visible')
      .eq('moderation_state', 'none')
      .eq('review_state', 'active')
      .order('created_at', { ascending: false })
      .limit(6)
    setSelectedReviews(data ?? [])
    setReviewsLoading(false)
  }, [])

  const handleSelectAgent = (agentId: string) => {
    if (agentId === selectedId) return
    setSelectedId(agentId)
    setSelectedReviews([])
    fetchReviewsForAgent(agentId)
    // URLにIDを反映してブラウザ履歴に残す
    const params = new URLSearchParams(searchParams.toString())
    params.set('id', agentId)
    router.replace(`/search?${params.toString()}`, { scroll: false })
  }

  useEffect(() => {
    const supabase = createClient()
    let cancelled = false

    const load = async () => {
      setLoading(true)
      setLoadError(false)

      const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
      const SUPA_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

      // ── Step 1: 公開データを先に取得（getUser()を待たない） ──
      // anonキーで直接fetchしてSupabaseクライアントの認証キューを完全に迂回する
      let publicData: any[] = []
      try {
        const res = await fetch(`${SUPA_URL}/rest/v1/safe_salesperson_profiles?select=*`, {
          headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` },
        })
        if (!res.ok) throw new Error(`${res.status}`)
        publicData = await res.json()
      } catch {
        if (!cancelled) { setLoadError(true); setLoading(false) }
        return
      }

      if (cancelled) return

      // ── Step 2: 一覧を即時表示（認証チェック完了を待たない） ──
      setAgents(publicData)
      if (publicData.length > 0) {
        const urlId = searchParams.get('id')
        const initialId = (urlId && publicData.find((a: any) => String(a.id) === String(urlId)))
          ? urlId : publicData[0].id
        setSelectedId(initialId)
        fetchReviewsForAgent(initialId)
      }
      if (!cancelled) setLoading(false)

      // ── Step 3: 認証チェック（一覧表示後に非同期で実行） ──
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user || cancelled) return

        setIsLoggedIn(true)

        const { data: ownProfile } = await supabase
          .from('salesperson_profiles').select('id').eq('user_id', user.id).maybeSingle()
        if (ownProfile) { router.replace('/salesperson/dashboard'); return }

        const [{ data: unlocked, error: unlockedError }, { data: myReviews }, { data: myOffers }] = await Promise.all([
          supabase.rpc('get_my_unlocked_salesperson_profiles'),
          supabase.from('anonymous_reviews').select('salesperson_id').eq('user_id', user.id).neq('review_state', 'superseded'),
          supabase.from('offers').select('salesperson_id').eq('buyer_id', user.id),
        ])
        if (cancelled) return
        if (unlockedError) console.error('[search] get_my_unlocked_salesperson_profiles error:', unlockedError)
        if (unlocked) {
          const map: Record<string, any> = {}
          unlocked.forEach((u: any) => { map[u.id] = u })
          setUnlockedMap(map)
        }
        const reviewedIds = new Set((myReviews ?? []).map((r: any) => r.salesperson_id as string))
        const offeredIds = new Set((myOffers ?? []).map((o: any) => o.salesperson_id as string))
        setContactedIds(new Set([...reviewedIds, ...offeredIds]))
        setPendingReviewCount([...offeredIds].filter((id) => !reviewedIds.has(id)).length)
      } catch {
        // 認証チェック失敗は無視（公開データは既に表示済み）
      }
    }

    load()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryCount])

  // ?ai=1 で自動的にAIモーダルを開く
  useEffect(() => {
    if (aiParam === '1' && !loading) setShowAiModal(true)
  }, [aiParam, loading])

  const prefectures = useMemo(() =>
    [...new Set(agents.map((a) => a.area_prefecture).filter(Boolean))].sort(), [agents])
  const specialties = useMemo(() =>
    [...new Set(agents.flatMap((a) => a.specialty_styles ?? []))].sort(), [agents])
  const qualifications = useMemo(() =>
    [...new Set(agents.flatMap((a) => a.qualifications ?? []))].sort(), [agents])

  const filteredAgents = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return agents.filter((a) => {
      if (kw) {
        const name = (unlockedMap[a.id]?.real_name ?? '').toLowerCase()
        const company = (a.company_name ?? '').toLowerCase()
        const bio = (a.bio ?? '').toLowerCase()
        const specialtyText = (a.specialty_styles ?? []).join(' ').toLowerCase()
        if (!name.includes(kw) && !company.includes(kw) && !bio.includes(kw) && !specialtyText.includes(kw)) return false
      }
      if (filterPrefecture && a.area_prefecture !== filterPrefecture) return false
      if (filterSpecialty && !(a.specialty_styles ?? []).includes(filterSpecialty)) return false
      if (filterQualification && !(a.qualifications ?? []).includes(filterQualification)) return false
      return true
    })
  }, [agents, unlockedMap, keyword, filterPrefecture, filterSpecialty, filterQualification])

  // メイン表示（接点済みを除外）・接点済みを分離
  const { mainAgents, contactedAgents } = useMemo(() => {
    let ordered = filteredAgents
    if (aiMode) {
      const aiOrder = aiMode.results.map((r) => r.agent_id)
      const aiAgents = aiOrder.map((id) => filteredAgents.find((a) => a.id === id)).filter(Boolean) as any[]
      const rest = filteredAgents.filter((a) => !aiOrder.includes(a.id))
      ordered = [...aiAgents, ...rest]
    } else if (styleParam && STYLE_QUADRANT[styleParam]) {
      const targetQ = STYLE_QUADRANT[styleParam]
      const matched = filteredAgents.filter((a) => agentQuadrantKey(a) === targetQ)
      const rest = filteredAgents.filter((a) => agentQuadrantKey(a) !== targetQ)
      ordered = [...matched, ...rest]
    }
    // ログイン施主のみ接点済みを分離（未ログインは全件メイン）
    if (isLoggedIn && contactedIds.size > 0) {
      return {
        mainAgents: ordered.filter((a) => !contactedIds.has(a.id)),
        contactedAgents: ordered.filter((a) => contactedIds.has(a.id)),
      }
    }
    return { mainAgents: ordered, contactedAgents: [] }
  }, [filteredAgents, aiMode, styleParam, isLoggedIn, contactedIds])

  const displayedAgents = mainAgents

  const getAiMatchReason = (agentId: string): string | null => {
    if (!aiMode) return null
    return aiMode.results.find((r) => r.agent_id === agentId)?.match_reason ?? null
  }

  useEffect(() => {
    if (loading || agents.length === 0) return
    if (filteredAgents.length === 0) { setSelectedId(null); setSelectedReviews([]); return }
    const stillValid = filteredAgents.find((a) => String(a.id) === String(selectedId))
    if (!stillValid) {
      const firstId = filteredAgents[0].id
      setSelectedId(firstId)
      fetchReviewsForAgent(firstId)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredAgents, loading])

  // contactedIds ロード後、選択中エージェントが接点済みになったら mainAgents 先頭に切り替える
  useEffect(() => {
    if (!isLoggedIn || contactedIds.size === 0 || !selectedId) return
    if (contactedIds.has(selectedId)) {
      const firstMain = filteredAgents.find((a) => !contactedIds.has(a.id))
      if (firstMain) {
        setSelectedId(firstMain.id)
        fetchReviewsForAgent(firstMain.id)
      } else {
        setSelectedId(null)
        setSelectedReviews([])
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactedIds, isLoggedIn])

  if (loadError) return (
    <div className="min-h-screen bg-stone-50">
      <Header />
      <div className="max-w-6xl mx-auto px-4 md:px-6 py-20 flex flex-col items-center gap-4 text-center">
        <p className="text-4xl">⚠️</p>
        <p className="text-base font-bold text-gray-700">データの取得に失敗しました</p>
        <p className="text-sm text-gray-400">ネットワーク接続を確認してからもう一度お試しください。</p>
        <button
          onClick={() => setRetryCount((c) => c + 1)}
          className="mt-2 bg-teal-500 hover:bg-teal-400 text-white font-bold px-6 py-3 rounded-xl text-sm transition"
        >
          再試行する
        </button>
      </div>
    </div>
  )

  if (loading) return (
    <div className="min-h-screen bg-stone-50">
      <Header />
      <div className="max-w-6xl mx-auto px-4 md:px-6 py-4">
        <div className="h-7 w-40 bg-stone-200 rounded-lg animate-pulse mb-6" />
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-white rounded-2xl border border-stone-200 p-4 flex gap-3 animate-pulse">
              <div className="w-12 h-12 rounded-full bg-stone-200 shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-24 bg-stone-200 rounded" />
                <div className="h-4 w-36 bg-stone-200 rounded" />
                <div className="h-3 w-20 bg-stone-200 rounded" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )

  // IDは型差(string/number)を吸収してString()で比較
  const selectedAgent = selectedId
    ? (agents.find((a) => String(a.id) === String(selectedId)) ?? null)
    : null
  const stickyDisplayName = selectedAgent
    ? (unlockedMap[selectedAgent.id]
        ? (unlockedMap[selectedAgent.id].real_name ?? (selectedAgent.name_initials ? `${selectedAgent.name_initials} さん` : '---'))
        : (selectedAgent.name_initials ? `${selectedAgent.name_initials} さん` : '---'))
    : ''
  const hasFilter = !!(keyword || filterPrefecture || filterSpecialty || filterQualification)

  return (
    <main className="min-h-screen bg-stone-50">
      <Header />

      {/* ページタイトル */}
      <div className="max-w-6xl mx-auto px-4 md:px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-black text-gray-800">営業マンを探す</h1>
          <p className="text-xs text-gray-500 mt-0.5">口コミ・スタイル・得意分野で絞り込めます</p>
        </div>
        <button
          onClick={() => setShowAiModal(true)}
          className="bg-orange-500 hover:bg-orange-400 text-white font-bold px-4 py-2 rounded-xl text-xs transition flex items-center gap-1.5 shrink-0"
        >
          <span>✨</span> AIに相談して探す
        </button>
      </div>

      {/* スタイルフィルターバナー */}
      {activeStyleLabel && !aiMode && (
        <div className="max-w-6xl mx-auto px-4 md:px-6 mb-2">
          <div className="bg-teal-50 border border-teal-200 rounded-2xl px-5 py-3.5 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-teal-700 mb-0.5">相性診断の結果でフィルター中</p>
              <p className="text-xs text-gray-600">「{activeStyleLabel}」の営業マンを先頭に表示しています</p>
            </div>
            <Link href="/search" className="text-xs text-gray-400 hover:text-gray-600 shrink-0 whitespace-nowrap transition">× 解除</Link>
          </div>
        </div>
      )}

      {/* AIモードバナー */}
      {aiMode && (
        <div className="max-w-6xl mx-auto px-4 md:px-6 mb-2">
          <div className="bg-orange-50 border border-orange-200 rounded-2xl px-5 py-3.5 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-bold text-orange-600 mb-0.5">AIが選んだ候補を表示中</p>
              <p className="text-xs text-gray-600 line-clamp-2">「{aiMode.query}」</p>
            </div>
            <button onClick={() => setAiMode(null)} className="text-xs text-gray-400 hover:text-gray-600 shrink-0 whitespace-nowrap transition">× 解除</button>
          </div>
        </div>
      )}

      {/* 検索・絞り込みエリア */}
      <div className="max-w-6xl mx-auto px-4 md:px-6">
        <div className="bg-white rounded-2xl border border-stone-200 p-4 space-y-3">
          <input
            type="text" value={keyword} onChange={(e) => setKeyword(e.target.value)}
            placeholder="キーワード・会社名・得意分野で検索"
            className="w-full text-sm text-gray-800 border border-stone-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-teal-200 bg-white"
          />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <select value={filterPrefecture} onChange={(e) => setFilterPrefecture(e.target.value)}
              className="text-sm border border-stone-200 rounded-xl px-3 py-2 focus:outline-none bg-white text-gray-600">
              <option value="">エリア（すべて）</option>
              {prefectures.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <select value={filterSpecialty} onChange={(e) => setFilterSpecialty(e.target.value)}
              className="text-sm border border-stone-200 rounded-xl px-3 py-2 focus:outline-none bg-white text-gray-600">
              <option value="">得意分野（すべて）</option>
              {specialties.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={filterQualification} onChange={(e) => setFilterQualification(e.target.value)}
              className="text-sm border border-stone-200 rounded-xl px-3 py-2 focus:outline-none bg-white text-gray-600">
              <option value="">資格（すべて）</option>
              {qualifications.map((q) => <option key={q} value={q}>{q}</option>)}
            </select>
          </div>
          {hasFilter && (
            <button onClick={() => { setKeyword(''); setFilterPrefecture(''); setFilterSpecialty(''); setFilterQualification('') }}
              className="text-xs text-teal-600 hover:text-teal-500 transition">
              × 絞り込みをリセット
            </button>
          )}
        </div>
        <p className="text-xs text-gray-400 mt-2 px-1">
          {displayedAgents.length}人の営業マンが見つかりました
          {contactedAgents.length > 0 && (
            <span className="ml-1">（相談・口コミ済み {contactedAgents.length}人を除く）</span>
          )}
        </p>
      </div>

      {/* 口コミ促進バナー（ログイン施主・相談済みで口コミ未投稿がいる場合） */}
      {isLoggedIn && pendingReviewCount > 0 && !bannerDismissed && (
        <div className="max-w-6xl mx-auto px-4 md:px-6">
          <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2 flex-1">
                <p className="text-sm font-bold text-amber-700">先に、相談した営業の口コミを残しませんか？</p>
                <p className="text-xs text-amber-600 leading-relaxed">
                  口コミを投稿すると、その営業が検索のメイン一覧から外れ、まだ接点のない営業を探しやすくなります。
                </p>
                <div className="flex gap-2 flex-wrap pt-1">
                  <Link href="/mypage"
                    className="text-xs bg-amber-500 hover:bg-amber-400 text-white font-bold px-3 py-1.5 rounded-lg transition">
                    口コミを投稿する
                  </Link>
                  <Link href="/mypage"
                    className="text-xs border border-amber-300 text-amber-700 hover:bg-amber-100 font-medium px-3 py-1.5 rounded-lg transition">
                    相談・口コミ管理を見る
                  </Link>
                  <button onClick={() => setBannerDismissed(true)}
                    className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5 transition">
                    あとで
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 営業カード一覧 */}
      <div className="max-w-6xl mx-auto px-4 md:px-6 mt-3">

        {/* PC: マスター・詳細レイアウト */}
        <div className="hidden md:flex gap-5 h-[calc(100vh-340px)] min-h-[500px] pb-6">

          {/* 左：カード一覧（42%） */}
          <div className="w-[42%] overflow-y-auto space-y-2.5 slim-scroll">
            {displayedAgents.length === 0 ? (
              <div className="text-center py-20 text-gray-400">
                <p className="text-4xl mb-4">👤</p>
                <p className="text-sm">{agents.length === 0 ? '現在登録中の営業マンはいません' : '条件に一致する営業マンが見つかりません'}</p>
              </div>
            ) : displayedAgents.map((agent) => {
              const isSelected = selectedId === agent.id
              const unlocked = !!unlockedMap[agent.id]
              const ai = (agent.ai_summary ?? null) as AISummary | null
              const displayName = unlocked
                ? (unlockedMap[agent.id]?.real_name ?? (agent.name_initials ? `${agent.name_initials} さん` : '---'))
                : (agent.name_initials ? `${agent.name_initials} さん` : '---')
              const themes: string[] = (agent.specialties ?? []).slice(0, 2)
              const matchCopy = ai?.goodMatch?.[0] ? formatMatchCopy(ai.goodMatch[0]) : null
              const aiReason = getAiMatchReason(agent.id)
              const isStyleMatch = styleParam && !aiMode && agentQuadrantKey(agent) === STYLE_QUADRANT[styleParam]

              return (
                <button key={agent.id} onClick={() => handleSelectAgent(agent.id)}
                  className={`w-full text-left rounded-2xl border p-4 transition-all duration-200 ${
                    isSelected ? 'bg-teal-50 border-teal-200 shadow-sm' : 'bg-white border-stone-200 hover:border-teal-200 hover:shadow-sm'
                  }`}>
                  <div className="flex items-start gap-3">
                    <div className="w-12 h-12 rounded-full overflow-hidden bg-stone-100 flex items-center justify-center shrink-0">
                      {unlocked && agent.profile_image_url ? <img src={agent.profile_image_url} alt="" className="w-full h-full object-cover" /> : <span className="text-xl">👤</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <p className="text-xs text-gray-400 truncate flex-1">{agent.company_name}</p>
                        {isStyleMatch && <span className="text-xs bg-teal-100 text-teal-600 px-1.5 py-0.5 rounded-full shrink-0 font-medium">相性◎</span>}
                        {agent.is_verified && (
                          <span
                            className="text-xs bg-blue-50 text-blue-500 px-1.5 py-0.5 rounded-full shrink-0 cursor-help"
                            title="登録メールのドメインが、選択された会社の登録ドメインと一致しています。本人性・現在の在籍・権限・営業品質をERABERUが保証するものではありません。"
                          >
                            ✓ 会社ドメイン一致
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-bold text-gray-800 truncate">{displayName}</p>
                      {agent.area_prefecture && <p className="text-xs text-gray-500">📍 {agent.area_prefecture}</p>}
                    </div>
                    {isSelected && <span className="text-teal-400 shrink-0 mt-0.5 text-sm">✓</span>}
                  </div>
                  {aiReason && (
                    <div className="mt-3 bg-orange-50 border border-orange-100 rounded-xl px-3 py-2">
                      <p className="text-xs text-orange-700 leading-relaxed"><span className="font-bold">AI推薦：</span>{aiReason}</p>
                    </div>
                  )}
                  {!aiReason && matchCopy && (
                    <p className={`text-xs font-semibold mt-3 leading-snug ${isSelected ? 'text-teal-700' : 'text-gray-700'}`}>{matchCopy}</p>
                  )}
                  {themes.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-3">
                      {themes.map((t) => (
                        <span key={t} className={`text-xs px-2 py-0.5 rounded-full border ${isSelected ? 'bg-teal-100 text-teal-700 border-teal-200' : 'bg-stone-50 text-gray-500 border-stone-100'}`}>{t}</span>
                      ))}
                    </div>
                  )}
                </button>
              )
            })}
          </div>

          {/* 右：詳細パネル（58%） */}
          <div className="flex-1 overflow-y-auto slim-scroll">
            {displayedAgents.length === 0 ? (
              <div className="h-full flex items-center justify-center text-gray-400">
                <div className="text-center">
                  <p className="text-4xl mb-3">👤</p>
                  <p className="text-sm">{agents.length === 0 ? '現在登録中の営業マンはいません' : '条件に一致する営業マンが見つかりません'}</p>
                </div>
              </div>
            ) : selectedAgent ? (
              <>
                <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm border-b border-stone-100 px-4 py-2.5 flex items-center justify-between mb-3 rounded-t-2xl">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-full overflow-hidden bg-stone-100 flex items-center justify-center shrink-0">
                      {unlockedMap[selectedAgent.id] && selectedAgent.profile_image_url
                        ? <img src={selectedAgent.profile_image_url} alt="" className="w-full h-full object-cover" />
                        : <span className="text-sm">👤</span>}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-gray-400 truncate leading-none">{selectedAgent.company_name}</p>
                      <p className="text-sm font-bold text-gray-800 truncate leading-snug">{stickyDisplayName}</p>
                    </div>
                  </div>
                  <Link href={`/salesperson/${selectedAgent.id}`}
                    className="shrink-0 text-xs bg-teal-500 hover:bg-teal-400 text-white font-bold px-3 py-1.5 rounded-lg transition ml-3">
                    詳細を見る
                  </Link>
                </div>
                {/* key変更でre-mountしてCSSアニメーションでフェードイン */}
                <div key={selectedAgent.id} className="detail-panel-enter">
                  <DetailPanel
                    agent={selectedAgent}
                    unlockedData={unlockedMap[selectedAgent.id] ?? null}
                    reviews={selectedReviews}
                    reviewsLoading={reviewsLoading}
                    onViewContact={handleViewContact}
                  />
                </div>
              </>
            ) : (
              <div className="h-full flex items-center justify-center text-gray-400">
                <p className="text-sm">読み込み中...</p>
              </div>
            )}
          </div>
        </div>

        {/* モバイル：カード一覧 */}
        <div className="md:hidden pt-2 space-y-4 pb-8">
          {displayedAgents.length === 0 ? (
            <div className="text-center py-20 text-gray-400">
              <p className="text-4xl mb-4">👤</p>
              <p className="text-sm">{agents.length === 0 ? '現在登録中の営業マンはいません' : '条件に一致する営業マンが見つかりません'}</p>
            </div>
          ) : displayedAgents.map((agent) => {
            const unlocked = !!unlockedMap[agent.id]
            const ai = (agent.ai_summary ?? null) as AISummary | null
            const matchCopy = ai?.goodMatch?.[0] ? formatMatchCopy(ai.goodMatch[0]) : null
            const aiReason = getAiMatchReason(agent.id)
            const isStyleMatch = styleParam && !aiMode && agentQuadrantKey(agent) === STYLE_QUADRANT[styleParam]
            return (
              <div key={agent.id} className="bg-white rounded-2xl border border-stone-200 p-5 hover:shadow-sm transition-shadow">
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-14 h-14 rounded-full overflow-hidden bg-stone-100 flex items-center justify-center shrink-0">
                    {unlocked && agent.profile_image_url ? <img src={agent.profile_image_url} alt="" className="w-full h-full object-cover" /> : <span className="text-2xl">👤</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-xs text-gray-400 truncate flex-1">{agent.company_name}</p>
                      {isStyleMatch && <span className="text-xs bg-teal-100 text-teal-600 px-1.5 py-0.5 rounded-full font-medium shrink-0">相性◎</span>}
                    </div>
                    <p className="text-base font-bold text-gray-800">
                      {unlocked ? (unlockedMap[agent.id]?.real_name ?? '---') : (agent.name_initials ? `${agent.name_initials} さん` : '---')}
                    </p>
                    {agent.area_prefecture && <p className="text-xs text-gray-500">📍 {agent.area_prefecture}</p>}
                    {!unlocked && <p className="text-xs text-stone-400 mt-0.5">🔒 氏名・写真は開示後に表示</p>}
                  </div>
                </div>
                {aiReason && (
                  <div className="mb-3 bg-orange-50 border border-orange-100 rounded-xl px-3 py-2">
                    <p className="text-xs text-orange-700 leading-relaxed"><span className="font-bold">AI推薦：</span>{aiReason}</p>
                  </div>
                )}
                {!aiReason && matchCopy && <p className="text-sm font-semibold text-gray-700 mb-1.5">{matchCopy}</p>}
                {ai?.communicationStyle && (
                  <p className="text-sm text-gray-600 leading-relaxed line-clamp-2">{ai.communicationStyle}</p>
                )}
                {(agent.specialties ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {(agent.specialties as string[]).slice(0, 2).map((s: string) => (
                      <span key={s} className="text-xs bg-teal-50 text-teal-700 border border-teal-100 px-2 py-0.5 rounded-full">{s}</span>
                    ))}
                  </div>
                )}
                <div className="flex gap-2 mt-4">
                  <Link href={`/salesperson/${agent.id}`}
                    className="flex-1 bg-teal-500 hover:bg-teal-400 text-white font-bold py-2.5 rounded-xl text-sm text-center transition">
                    詳しく見る
                  </Link>
                  {!unlocked && (
                    <button onClick={() => handleViewContact(agent.id)}
                      className="flex-1 bg-orange-500 hover:bg-orange-400 text-white font-bold py-2.5 rounded-xl text-sm transition">
                      名前・連絡先を見る
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* 接点済み営業セクション（折りたたみ） */}
      {contactedAgents.length > 0 && (
        <div className="max-w-6xl mx-auto px-4 md:px-6 pb-8">
          <button
            onClick={() => setShowContactedSection((v) => !v)}
            className="w-full flex items-center justify-between px-5 py-3.5 bg-stone-100 hover:bg-stone-200 rounded-2xl text-sm text-gray-600 transition"
          >
            <span>相談・口コミ済みの営業（{contactedAgents.length}人）</span>
            <span>{showContactedSection ? '▲ 閉じる' : '▼ 表示する'}</span>
          </button>
          {showContactedSection && (
            <div className="mt-3 space-y-2.5">
              <p className="text-xs text-gray-400 px-1">すでに接点のある営業マンです。<Link href="/mypage" className="text-teal-600 hover:underline">相談・口コミ管理</Link>から口コミを投稿できます。</p>
              {contactedAgents.map((agent) => {
                const unlocked = !!unlockedMap[agent.id]
                const displayName = unlocked
                  ? (unlockedMap[agent.id]?.real_name ?? (agent.name_initials ? `${agent.name_initials} さん` : '---'))
                  : (agent.name_initials ? `${agent.name_initials} さん` : '---')
                return (
                  <div key={agent.id} className="bg-white rounded-xl border border-stone-200 px-4 py-3 flex items-center justify-between gap-3 opacity-70">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-full overflow-hidden bg-stone-100 flex items-center justify-center shrink-0">
                        {unlocked && agent.profile_image_url ? <img src={agent.profile_image_url} alt="" className="w-full h-full object-cover" /> : <span className="text-lg">👤</span>}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs text-gray-400 truncate">{agent.company_name}</p>
                        <p className="text-sm font-bold text-gray-700 truncate">{displayName}</p>
                      </div>
                    </div>
                    <Link href={`/salesperson/${agent.id}`} className="text-xs text-teal-600 border border-teal-200 px-3 py-1.5 rounded-lg shrink-0 hover:bg-teal-50 transition">
                      詳細を見る
                    </Link>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {showLoginGate && <LoginGateModal onClose={() => setShowLoginGate(false)} />}
      {showAiModal && (
        <AiSearchModal
          onClose={() => {
            setShowAiModal(false)
            if (aiParam === '1') router.replace('/search', { scroll: false })
          }}
          onSearchComplete={handleAiSearchComplete}
          agents={agents}
        />
      )}
    </main>
  )
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-stone-50" />}>
      <SearchContent />
    </Suspense>
  )
}
