'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'

const PHASES = [
  { value: 'post_contract', label: '契約後', description: '契約締結後の対応について' },
  { value: 'after_start', label: '着工後', description: '着工後の現場対応について' },
  { value: 'after_handover', label: '引渡後', description: '引渡し後のアフターフォローについて' },
] as const

const RATING_LABELS = ['', '不満', 'やや不満', '普通', '満足', 'とても満足']

type Phase = typeof PHASES[number]['value']

export default function WriteReviewPage() {
  const { salesperson_id } = useParams()
  const router = useRouter()

  const [salesperson, setSalesperson] = useState<any>(null)
  const [realName, setRealName] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [accessDenied, setAccessDenied] = useState(false)
  const [authLoading, setAuthLoading] = useState(true)
  const [accessToken, setAccessToken] = useState<string | null>(null)

  const [submittedPhases, setSubmittedPhases] = useState<Phase[]>([])
  const [phase, setPhase] = useState<Phase>('post_contract')
  const [rating, setRating] = useState(0)
  const [content, setContent] = useState('')
  const [step, setStep] = useState<'form' | 'confirm'>('form')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const [consentAccepted, setConsentAccepted] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.push(`/auth/login?redirect=/review/write/${salesperson_id}`)
        return
      }
      setAccessToken(session.access_token)
      setAuthLoading(false)
    })
  }, [salesperson_id, router])

  useEffect(() => {
    if (authLoading || !accessToken) return
    const load = async () => {
      const supabase = createClient()

      // safe_salesperson_profiles には family_name/given_name/real_name がないため name_initials を使用
      const { data: sp } = await supabase
        .from('safe_salesperson_profiles')
        .select('id, name_initials, company_name, department')
        .eq('id', salesperson_id as string)
        .maybeSingle()

      if (!sp) { setNotFound(true); return }
      setSalesperson(sp)

      // 権限チェック：このユーザーが対象営業へ offer を送信済み、または既に口コミ投稿済みかを確認
      const { data: { user: currentUser } } = await supabase.auth.getUser()
      const [{ count: offerCount }, { data: ownPhaseData }] = await Promise.all([
        supabase
          .from('offers')
          .select('id', { count: 'exact', head: true })
          .eq('salesperson_id', salesperson_id as string),
        // RLS "authenticated can read own reviews" で自分のレビューのみ返る
        supabase
          .from('anonymous_reviews')
          .select('phase')
          .eq('salesperson_id', salesperson_id as string)
          .eq('user_id', currentUser?.id ?? 'INVALID')
          .in('phase', ['post_contract', 'after_start', 'after_handover'])
          .neq('review_state', 'superseded'),
      ])

      const hasPermission = (offerCount ?? 0) > 0 || (ownPhaseData ?? []).length > 0
      if (!hasPermission) { setAccessDenied(true); return }

      if (ownPhaseData) {
        setSubmittedPhases(ownPhaseData.map((r: any) => r.phase))
      }

      // アクセス権確認済みなので実名を取得
      const { data: nameData } = await supabase.rpc('get_salesperson_name_for_reviewer', {
        p_salesperson_id: salesperson_id as string,
      })
      if (nameData) setRealName(nameData)
    }
    load()
  }, [authLoading, accessToken, salesperson_id])

  const handleSubmit = async () => {
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch('/api/review/submit-authenticated', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ salesperson_id, phase, rating, content, consentAccepted }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? '投稿に失敗しました')
        setStep('form')
      } else {
        setDone(true)
      }
    } catch {
      setError('通信エラーが発生しました')
      setStep('form')
    } finally {
      setSubmitting(false)
    }
  }

  if (authLoading) {
    return <div className="min-h-screen bg-stone-100 flex items-center justify-center text-gray-400">認証確認中...</div>
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-stone-100 flex flex-col items-center justify-center gap-4 px-6">
        <span className="text-5xl">🚫</span>
        <p className="text-lg font-bold text-gray-700">営業マンが見つかりません</p>
      </div>
    )
  }

  if (accessDenied) {
    return (
      <div className="min-h-screen bg-stone-100 flex flex-col items-center justify-center gap-4 px-6 text-center">
        <span className="text-5xl">🔒</span>
        <p className="text-lg font-bold text-gray-700">口コミ投稿にはやりとりの記録が必要です</p>
        <p className="text-sm text-gray-500 leading-relaxed">
          この営業マンへの相談リクエスト、または既存の口コミがある場合のみ追加投稿できます。
        </p>
        <Link href="/mypage" className="text-sm text-teal-600 hover:underline">相談・口コミ管理へ</Link>
      </div>
    )
  }

  if (!salesperson) {
    return <div className="min-h-screen bg-stone-100 flex items-center justify-center text-gray-400">読み込み中...</div>
  }

  // 実名が取得できた場合は実名、なければイニシャルにフォールバック
  const displayName = realName ?? salesperson.name_initials ?? salesperson.company_name

  const availablePhases = PHASES.filter((p) => !submittedPhases.includes(p.value))

  if (done) {
    return (
      <main className="min-h-screen bg-stone-100">
        <header className="bg-gray-900 px-6 py-4">
          <div className="max-w-5xl mx-auto">
            <Link href="/" className="text-2xl font-black text-white tracking-tight">ERABERU</Link>
          </div>
        </header>
        <div className="flex flex-col items-center justify-center min-h-[80vh] gap-6 px-6">
          <div className="text-center space-y-2">
            <span className="text-5xl block mb-2">✅</span>
            <p className="text-lg font-bold text-gray-700">口コミを投稿しました</p>
            <p className="text-sm text-gray-400">ご協力ありがとうございました。</p>
            <p className="text-sm text-gray-400">担当者の確認後に公開されます。</p>
          </div>
          <Link
            href={`/salesperson/${salesperson_id}`}
            className="block bg-orange-500 hover:bg-orange-400 text-white font-bold py-3 px-8 rounded-xl transition text-sm"
          >
            {displayName} さんのページへ戻る
          </Link>
        </div>
      </main>
    )
  }

  if (availablePhases.length === 0) {
    return (
      <main className="min-h-screen bg-stone-100">
        <header className="bg-gray-900 px-6 py-4">
          <div className="max-w-5xl mx-auto">
            <Link href="/" className="text-2xl font-black text-white tracking-tight">ERABERU</Link>
          </div>
        </header>
        <div className="flex flex-col items-center justify-center min-h-[80vh] gap-4 px-6 text-center">
          <span className="text-5xl">✔️</span>
          <p className="text-lg font-bold text-gray-700">すべてのフェーズの口コミを投稿済みです</p>
          <p className="text-sm text-gray-400">契約後・着工後・引渡後の口コミはそれぞれ1件ずつ投稿できます。</p>
          <Link href={`/salesperson/${salesperson_id}`} className="text-sm text-orange-500 hover:underline mt-2">
            {displayName}さんのページへ
          </Link>
        </div>
      </main>
    )
  }

  // フェーズが未選択 or 投稿済みなら最初の利用可能フェーズへ
  const currentPhase = availablePhases.find((p) => p.value === phase) ?? availablePhases[0]

  return (
    <main className="min-h-screen bg-stone-100">
      <header className="bg-gray-900 px-6 py-4">
        <div className="max-w-5xl mx-auto">
          <Link href="/" className="text-2xl font-black text-white tracking-tight">ERABERU</Link>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-6 py-10 space-y-6">

        {/* ヘッダー */}
        <div className="text-center space-y-1">
          <div className="inline-block bg-orange-100 text-orange-600 text-xs font-bold px-3 py-1 rounded-full mb-2">
            口コミ投稿
          </div>
          <p className="text-xl font-bold text-gray-800">{displayName}</p>
          <p className="text-sm text-gray-500">{salesperson.company_name}
            {salesperson.department && `・${salesperson.department}`}
          </p>
        </div>

        {/* ステップインジケーター */}
        <div className="flex items-center justify-center gap-2">
          {(['form', 'confirm'] as const).map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              {i > 0 && <div className="w-8 h-px bg-stone-200" />}
              <div className={`flex items-center gap-1.5 text-xs font-medium ${step === s ? 'text-orange-500' : 'text-gray-300'}`}>
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${step === s ? 'bg-orange-500 text-white' : 'bg-gray-200 text-gray-400'}`}>
                  {i + 1}
                </span>
                {s === 'form' ? '入力' : '確認'}
              </div>
            </div>
          ))}
        </div>

        {step === 'form' && (
          <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-6 space-y-5">

            {/* フェーズ選択 */}
            <div>
              <p className="text-xs text-gray-500 font-medium mb-2">
                フェーズ <span className="text-red-400">*</span>
              </p>
              <div className="space-y-2">
                {availablePhases.map((p) => (
                  <button
                    key={p.value}
                    onClick={() => setPhase(p.value)}
                    className={`w-full text-left px-4 py-3 rounded-xl border text-sm transition ${
                      phase === p.value
                        ? 'border-orange-400 bg-orange-50 text-orange-700 font-medium'
                        : 'border-stone-200 text-gray-600 hover:border-stone-300'
                    }`}
                  >
                    <span className="font-bold">{p.label}</span>
                    <span className="text-xs text-gray-400 ml-2">{p.description}</span>
                  </button>
                ))}
                {submittedPhases.length > 0 && (
                  <p className="text-xs text-gray-400 pt-1">
                    ※ {submittedPhases.map((v) => PHASES.find((p) => p.value === v)?.label).join('・')}は投稿済みです
                  </p>
                )}
              </div>
            </div>

            {/* 評価 */}
            <div>
              <p className="text-xs text-gray-500 font-medium mb-2">
                評価 <span className="text-red-400">*</span>
              </p>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    onClick={() => setRating(star)}
                    className={`text-3xl transition-transform hover:scale-110 ${star <= rating ? 'text-amber-400' : 'text-gray-200'}`}
                  >
                    ★
                  </button>
                ))}
              </div>
              {rating > 0 && <p className="text-xs text-gray-400 mt-1">{RATING_LABELS[rating]}</p>}
            </div>

            {/* コメント */}
            <div>
              <p className="text-xs text-gray-500 font-medium mb-2">
                コメント <span className="text-red-400">*</span>
              </p>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={`${displayName}さんの${currentPhase.label}の対応はいかがでしたか？`}
                rows={5}
                className="w-full text-sm text-gray-800 border border-stone-200 rounded-xl px-4 py-3 resize-none focus:outline-none focus:ring-2 focus:ring-orange-300"
              />
              <p className="text-xs text-gray-300 mt-1 text-right">{content.length} 文字</p>
            </div>

            {error && <p className="text-sm text-red-500 bg-red-50 rounded-xl px-4 py-3">{error}</p>}

            <button
              onClick={() => { setPhase(phase || currentPhase.value); setStep('confirm') }}
              disabled={rating === 0 || !content.trim()}
              className="w-full bg-orange-500 hover:bg-orange-400 disabled:bg-gray-200 disabled:text-gray-400 text-white font-bold py-4 rounded-xl transition text-sm"
            >
              入力内容を確認する
            </button>

            <p className="text-xs text-gray-300 text-center leading-relaxed">
              投稿された口コミは有料開示ユーザーのみ閲覧できます。<br />
              個人を特定できる情報は記載しないようにしてください。
            </p>
          </div>
        )}

        {step === 'confirm' && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-6 space-y-4">
              <p className="text-sm font-bold text-gray-700">投稿内容の確認</p>

              <div className="space-y-4 text-sm">
                <div className="flex items-center justify-between py-3 border-b border-stone-100">
                  <p className="text-xs text-gray-400 w-16 shrink-0">フェーズ</p>
                  <p className="text-gray-700 font-medium">{PHASES.find((p) => p.value === phase)?.label}</p>
                </div>
                <div className="flex items-center justify-between py-3 border-b border-stone-100">
                  <p className="text-xs text-gray-400 w-16 shrink-0">評価</p>
                  <div className="text-right">
                    <p className="text-amber-400 text-lg tracking-wide">
                      {'★'.repeat(rating)}{'☆'.repeat(5 - rating)}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">{RATING_LABELS[rating]}</p>
                  </div>
                </div>
                <div className="py-3">
                  <p className="text-xs text-gray-400 mb-2">コメント</p>
                  <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">{content}</p>
                </div>
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              <p className="text-xs text-amber-700 leading-relaxed">
                投稿後の編集・削除はできません。内容をご確認のうえ送信してください。
              </p>
            </div>

            {/* 同意UI */}
            <div className="bg-stone-50 border border-stone-200 rounded-xl p-4 space-y-3">
              <p className="text-xs font-bold text-gray-700">投稿前にご確認ください</p>
              <ul className="text-xs text-gray-600 leading-relaxed space-y-1.5 list-disc list-inside">
                <li>投稿内容は、営業担当者のプロフィール表示、口コミ要約、サービス改善に利用される場合があります。</li>
                <li>投稿した文章そのものが、あなたの許可なく住宅会社に個別提供されたり、書籍・広告等に掲載されたりすることはありません。</li>
                <li>投稿内容は、個人が特定されないよう配慮したうえで、統計化・要約化された分析データとして営業改善等に活用される場合があります。</li>
                <li>口コミ等の情報はAIその他の自動処理技術により紹介文・要約文等の作成に利用される場合があります。</li>
                <li>個人を特定できる情報、事実確認が困難な断定表現、誹謗中傷、虚偽の内容、実体験に基づかない投稿は掲載できません。</li>
              </ul>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={consentAccepted}
                  onChange={(e) => setConsentAccepted(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-orange-500 shrink-0"
                />
                <span className="text-xs text-gray-700 leading-relaxed">
                  上記の内容を確認し、
                  <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-teal-600 hover:underline">利用規約</a>・
                  <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-teal-600 hover:underline">プライバシーポリシー</a>
                  に同意して投稿します。
                </span>
              </label>
            </div>

            {error && <p className="text-sm text-red-500 bg-red-50 rounded-xl px-4 py-3">{error}</p>}

            <div className="flex gap-3">
              <button
                onClick={() => { setStep('form'); setError('') }}
                disabled={submitting}
                className="flex-1 bg-stone-100 hover:bg-stone-200 disabled:opacity-50 text-gray-600 font-bold py-4 rounded-xl transition text-sm"
              >
                修正する
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting || !consentAccepted}
                className="flex-1 bg-orange-500 hover:bg-orange-400 disabled:bg-gray-200 disabled:text-gray-400 text-white font-bold py-4 rounded-xl transition text-sm"
              >
                {submitting ? '送信中...' : '投稿する'}
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
