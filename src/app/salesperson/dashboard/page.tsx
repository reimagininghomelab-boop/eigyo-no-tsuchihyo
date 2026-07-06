'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import Header from '@/components/Header'
import { QRCodeSVG } from 'qrcode.react'
import { MUNICIPALITIES, PREFECTURES } from '@/lib/municipalities'
import Cropper from 'react-easy-crop'
import type { Area } from 'react-easy-crop'

type Tab = 'reviews' | 'settings' | 'preview' | 'offers'

const PHASE_META = [
  { key: 'pre_contract', label: '契約前', badge: 'bg-teal-50 text-teal-600' },
  { key: 'post_contract', label: '契約後', badge: 'bg-blue-50 text-blue-600' },
  { key: 'after_start', label: '着工後', badge: 'bg-purple-50 text-purple-600' },
  { key: 'after_handover', label: '引渡後', badge: 'bg-green-50 text-green-600' },
] as const

const SALES_STYLE_AXES = [
  { key: 'listening_proposing', left: '傾聴型', right: '提案型' },
  { key: 'numbers_feeling', left: '数字で説明', right: '感覚で説明' },
]

const SPECIALTY_OPTIONS = [
  '自由設計', '規格住宅', 'セミオーダー',
  '平屋', '二世帯住宅', '狭小住宅',
  '高断熱・高気密', '省エネ・ZEH', 'デザイン住宅',
  '土地探し', '資金計画', 'リフォーム・リノベ',
]

const SPECIALTIES_OPTIONS = [
  '資金計画の相談', '住宅ローンの相談', '土地探しからの家づくり', '土地の注意点整理',
  '間取り要望の整理', '家事動線・生活動線の相談', '収納計画の相談', '子育て世帯の住まい相談',
  '共働き世帯の住まい相談', '平屋の相談', '二世帯住宅の相談', '断熱・省エネ住宅の説明',
  '耐震性能の説明', '外観・内装デザインの相談', '設備・仕様選びの相談', '見積内容の説明',
  '契約前の不安整理', '他社比較中の判断整理', '打合せ内容の整理', '引渡し後のフォロー',
]
const MAX_SPECIALTIES = 5
const QUALIFICATION_OPTIONS = ['宅地建物取引士', 'ファイナンシャルプランナー', '住宅ローンアドバイザー', '福祉住環境コーディネーター', '建築士']

export default function SalespersonDashboard() {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('reviews')
  const [profile, setProfile] = useState<any>(null)
  const [anonReviews, setAnonReviews] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [qrToken, setQrToken] = useState<string>('')
  const [qrReissuing, setQrReissuing] = useState(false)
  const [qrCopied, setQrCopied] = useState(false)
  const [offersList, setOffersList] = useState<any[]>([])

  const [visibilityUpdating, setVisibilityUpdating] = useState(false)

  // settings form state
  const [form, setForm] = useState<any>({})
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [aiMsg, setAiMsg] = useState('')

  // tag input helpers
  const [qualInput, setQualInput] = useState('')
  const [corePrefecture, setCorePrefecture] = useState('')

  // image upload & crop
  const [imageUploading, setImageUploading] = useState(false)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [cropSrc, setCropSrc] = useState<string | null>(null)
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null)

  useEffect(() => {
    // URL パラメータで初期タブを指定可能（例: ?tab=offers）
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search).get('tab')
      if (p === 'offers' || p === 'settings' || p === 'preview') setTab(p as Tab)
    }
  }, [])

  useEffect(() => {
    const supabase = createClient()
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.replace('/auth/login'); return }

      const { data: own } = await supabase
        .from('salesperson_profiles')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle()
      if (!own) { router.replace('/'); return }

      setProfile(own)
      setImageUrl(own.profile_image_url ?? null)
      setQrToken(own.qr_token ?? '')
      const coreCity = own.core_city ?? ''
      setForm({
        family_name: own.family_name ?? '',
        given_name: own.given_name ?? '',
        company_name: own.company_name ?? '',
        department: own.department ?? '',
        bio: own.bio ?? '',
        core_city: coreCity,
        contract_count: own.contract_count ?? '',
        specialty_styles: own.specialty_styles ?? [],
        qualifications: own.qualifications ?? [],
        specialties: own.specialties ?? [],
        available_prefectures: own.available_prefectures ?? [],
        sales_styles: own.sales_styles ?? {},
      })
      // 既存のcore_cityから都道府県を逆引きして初期化
      if (coreCity) {
        const foundPref = PREFECTURES.find((pref) =>
          (MUNICIPALITIES[pref] ?? []).includes(coreCity)
        )
        if (foundPref) setCorePrefecture(foundPref)
      }

      const { data: ar } = await supabase
        .from('anonymous_reviews')
        .select('id, rating, content, phase, source, status, created_at')
        .eq('salesperson_id', own.id)
        .neq('status', 'superseded')
        .order('created_at', { ascending: false })
      if (ar) setAnonReviews(ar)

      const { data: offersData } = await supabase
        .from('offers')
        .select('id, area, timing, message, contact_name, contact_email, status, created_at')
        .eq('salesperson_id', own.id)
        .order('created_at', { ascending: false })
      if (offersData) setOffersList(offersData)

      setLoading(false)
    }
    load()
  }, [])

  const handleToggleVisibility = async () => {
    if (!profile || visibilityUpdating) return
    setVisibilityUpdating(true)
    const supabase = createClient()
    const newVal = !profile.is_visible
    const { error } = await supabase
      .from('salesperson_profiles')
      .update({ is_visible: newVal })
      .eq('id', profile.id)
    if (!error) setProfile({ ...profile, is_visible: newVal })
    setVisibilityUpdating(false)
  }

  const handleReissueQr = async () => {
    if (!profile || qrReissuing) return
    if (!confirm('QRコードを再発行すると、以前のQRコードからの投稿ができなくなります。続けますか？')) return
    setQrReissuing(true)
    const newToken = crypto.randomUUID()
    const supabase = createClient()
    const { error } = await supabase.from('salesperson_profiles').update({ qr_token: newToken }).eq('id', profile.id)
    if (!error) setQrToken(newToken)
    setQrReissuing(false)
  }

  const handleCopyQrUrl = async () => {
    await navigator.clipboard.writeText(`${window.location.origin}/review/${qrToken}`)
    setQrCopied(true)
    setTimeout(() => setQrCopied(false), 2000)
  }

  const handleToggleReview = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === 'visible' ? 'hidden' : 'visible'
    const supabase = createClient()
    const { error } = await supabase.from('anonymous_reviews').update({ status: newStatus }).eq('id', id)
    if (!error) {
      setAnonReviews((prev) => prev.map((r) => r.id === id ? { ...r, status: newStatus } : r))
    }
  }

  const onCropComplete = useCallback((_: Area, areaPixels: Area) => {
    setCroppedAreaPixels(areaPixels)
  }, [])

  const getCroppedBlob = (src: string, area: Area, maxBytes: number): Promise<Blob> =>
    new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        const SIZE = 400
        canvas.width = SIZE
        canvas.height = SIZE
        canvas.getContext('2d')!.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, SIZE, SIZE)
        let quality = 0.85
        const tryExport = () => {
          canvas.toBlob((blob) => {
            if (!blob) return reject(new Error('変換失敗'))
            if (blob.size <= maxBytes || quality <= 0.3) return resolve(blob)
            quality -= 0.1
            tryExport()
          }, 'image/jpeg', quality)
        }
        tryExport()
      }
      img.onerror = reject
      img.src = src
    })

  const handleFileSelect = (file: File) => {
    const url = URL.createObjectURL(file)
    setCropSrc(url)
    setCrop({ x: 0, y: 0 })
    setZoom(1)
  }

  const handleCropConfirm = async () => {
    if (!cropSrc || !croppedAreaPixels) return
    setImageUploading(true)
    setCropSrc(null)

    const blob = await getCroppedBlob(cropSrc, croppedAreaPixels, 524288).catch(() => null)
    URL.revokeObjectURL(cropSrc)
    if (!blob) { setImageUploading(false); return }

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setImageUploading(false); return }

    const path = `${user.id}/avatar.jpg`
    const { error } = await supabase.storage
      .from('profile-images')
      .upload(path, blob, { upsert: true, contentType: 'image/jpeg' })
    if (error) { setImageUploading(false); return }

    const { data: { publicUrl } } = supabase.storage.from('profile-images').getPublicUrl(path)
    await supabase.from('salesperson_profiles').update({ profile_image_url: publicUrl }).eq('id', profile.id)
    setImageUrl(publicUrl)
    setImageUploading(false)
  }

  const handleSaveSettings = async () => {
    setSaving(true)
    setSaveMsg('')
    const supabase = createClient()
    const { error } = await supabase.from('salesperson_profiles').update({
      family_name: form.family_name || null,
      given_name: form.given_name || null,
      company_name: form.company_name || null,
      department: form.department || null,
      bio: form.bio || null,
      area_prefecture: corePrefecture || null,
      core_city: form.core_city || null,
      contract_count: form.contract_count !== '' ? Number(form.contract_count) : null,
      specialty_styles: form.specialty_styles,
      qualifications: form.qualifications,
      specialties: form.specialties ?? [],
      available_prefectures: form.available_prefectures,
      sales_styles: form.sales_styles,
    }).eq('id', profile.id)
    setSaving(false)
    setSaveMsg(error ? '保存に失敗しました' : '保存しました')
    setTimeout(() => setSaveMsg(''), 3000)
    if (!error) {
      setAiMsg('AI紹介文を更新中...')
      fetch('/api/ai/generate-own-intro', { method: 'POST' })
        .then(async (res) => {
          const json = await res.json()
          if (!res.ok) setAiMsg(`AI生成エラー: ${json.error ?? res.status}`)
          else setAiMsg('AI紹介文を更新しました')
          setTimeout(() => setAiMsg(''), 5000)
        })
        .catch((e) => { setAiMsg(`AI生成エラー: ${e.message}`); setTimeout(() => setAiMsg(''), 5000) })
    }
  }

  const toggleTag = (field: 'specialty_styles' | 'qualifications' | 'available_prefectures', value: string) => {
    setForm((prev: any) => {
      const arr: string[] = prev[field] ?? []
      return {
        ...prev,
        [field]: arr.includes(value) ? arr.filter((v: string) => v !== value) : [...arr, value],
      }
    })
  }

  const addCustomTag = (field: 'specialty_styles' | 'qualifications' | 'available_prefectures', value: string) => {
    const v = value.trim()
    if (!v) return
    setForm((prev: any) => {
      const arr: string[] = prev[field] ?? []
      if (arr.includes(v)) return prev
      return { ...prev, [field]: [...arr, v] }
    })
  }

  if (loading) return (
    <div className="min-h-screen bg-stone-100 flex items-center justify-center text-gray-400">読み込み中...</div>
  )
  if (!profile) return null

  const displayName = profile.family_name && profile.given_name
    ? `${profile.family_name} ${profile.given_name}`
    : profile.real_name

  const reviewsByPhase = PHASE_META.reduce((acc, p) => {
    acc[p.key] = anonReviews.filter((r) => r.phase === p.key)
    return acc
  }, {} as Record<string, any[]>)

  return (
    <main className="min-h-screen bg-stone-100">
      <Header />

      <div className="max-w-2xl mx-auto px-6 py-8 space-y-4">

        {/* ステータスバナー */}
        {profile.status === 'pending' && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4">
            <p className="text-sm font-semibold text-amber-700">審査中</p>
            <p className="text-xs text-amber-600 mt-0.5">プロフィールは管理者の承認後に公開されます</p>
          </div>
        )}
        {profile.status === 'suspended' && (
          <div className="bg-gray-100 border border-gray-300 rounded-2xl px-5 py-4">
            <p className="text-sm font-semibold text-gray-600">一時停止中</p>
          </div>
        )}
        {profile.status === 'rejected' && (
          <div className="bg-red-50 border border-red-200 rounded-2xl px-5 py-4">
            <p className="text-sm font-semibold text-red-600">審査否認</p>
          </div>
        )}

        {/* ヘッダー */}
        <div className="bg-stone-50 rounded-2xl shadow-sm border border-stone-200 px-6 py-5 flex items-center justify-between">
          <div>
            <p className="text-lg font-bold text-gray-800">{displayName}</p>
            <p className="text-xs text-gray-500 mt-0.5">{profile.company_name}</p>
          </div>
          {profile.status === 'active' && (
            <div className="flex items-center gap-2">
              {profile.is_visible
                ? <span className="text-xs bg-green-100 text-green-700 font-medium px-3 py-1 rounded-full">✓ 公開中</span>
                : <span className="text-xs bg-gray-100 text-gray-500 font-medium px-3 py-1 rounded-full">一時停止中</span>
              }
              <button
                onClick={handleToggleVisibility}
                disabled={visibilityUpdating}
                className={`text-xs px-3 py-1 rounded-full border transition font-medium ${
                  profile.is_visible
                    ? 'border-gray-300 text-gray-500 hover:bg-gray-100'
                    : 'border-teal-400 text-teal-600 hover:bg-teal-50'
                }`}
              >
                {visibilityUpdating ? '...' : profile.is_visible ? '一時停止' : '公開再開'}
              </button>
            </div>
          )}
        </div>

        {/* タブ */}
        <div className="flex bg-stone-200 rounded-xl p-1 gap-1 flex-wrap">
          {([
            { key: 'reviews', label: '口コミ管理' },
            { key: 'offers', label: `相談リクエスト${offersList.filter(o => o.status === 'new').length > 0 ? ` (${offersList.filter(o => o.status === 'new').length})` : ''}` },
            { key: 'settings', label: 'プロフィール設定' },
            { key: 'preview', label: '施主プレビュー' },
          ] as { key: Tab; label: string }[]).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 text-xs font-medium py-2 rounded-lg transition ${
                tab === t.key ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ===== 口コミ管理タブ ===== */}
        {tab === 'reviews' && (
          <div className="space-y-4">
            {/* QRコード */}
            {profile.status === 'active' && qrToken && (
              <div className="bg-stone-50 rounded-2xl shadow-sm border border-stone-200 p-6">
                <div className="mb-4">
                  <p className="text-sm font-bold text-gray-700">口コミ用QRコード（契約前）</p>
                  <p className="text-xs text-gray-400 mt-0.5">お客様に読み取ってもらうと、会員登録なしで口コミを投稿できます</p>
                </div>
                <div className="flex flex-col items-center gap-4">
                  <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-sm">
                    <QRCodeSVG
                      value={`${typeof window !== 'undefined' ? window.location.origin : 'https://eigyo-no-tsuchihyo.vercel.app'}/review/${qrToken}`}
                      size={160}
                      bgColor="#ffffff"
                      fgColor="#1c1917"
                    />
                  </div>
                  <div className="flex gap-2 w-full">
                    <button
                      onClick={handleCopyQrUrl}
                      className="flex-1 text-sm border border-stone-300 text-gray-600 hover:bg-stone-100 font-medium py-2.5 rounded-xl transition"
                    >
                      {qrCopied ? '✓ コピー済み' : 'URLをコピー'}
                    </button>
                    <button
                      onClick={handleReissueQr}
                      disabled={qrReissuing}
                      className="flex-1 text-sm border border-red-200 text-red-500 hover:bg-red-50 disabled:opacity-50 font-medium py-2.5 rounded-xl transition"
                    >
                      {qrReissuing ? '再発行中...' : 'QRを再発行'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* フェーズ別口コミ */}
            {PHASE_META.map(({ key, label, badge }) => {
              const phaseRevs = reviewsByPhase[key] ?? []
              const visibleCount = phaseRevs.filter((r) => r.status === 'visible').length
              return (
                <div key={key} className="bg-stone-50 rounded-2xl shadow-sm border border-stone-200 p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${badge}`}>{label}</span>
                      <span className="text-xs text-gray-400">{visibleCount}/{phaseRevs.length}件表示中</span>
                    </div>
                  </div>
                  {phaseRevs.length === 0 ? (
                    <p className="text-sm text-gray-400">まだ口コミはありません</p>
                  ) : (
                    <div className="space-y-4">
                      {phaseRevs.map((r) => (
                        <div key={r.id} className={`rounded-xl border p-4 transition ${r.status === 'hidden' ? 'border-stone-100 bg-stone-50 opacity-60' : 'border-stone-200 bg-white'}`}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              {r.rating && (
                                <p className="text-sm text-amber-400 mb-1">
                                  {'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}
                                </p>
                              )}
                              <p className={`text-sm leading-relaxed ${r.status === 'hidden' ? 'text-gray-400' : 'text-gray-700'}`}>
                                {r.content}
                              </p>
                              <p className="text-xs text-gray-400 mt-1.5">
                                {new Date(r.created_at).toLocaleDateString('ja-JP')}
                                {r.status === 'hidden' && <span className="ml-2 text-stone-400">（非表示中）</span>}
                              </p>
                            </div>
                            {/* 第一段階: 営業の直接status更新をDB側で停止したため一時無効化。第二段階で hide_own_review RPC に接続予定 */}
                            <button
                              onClick={() => handleToggleReview(r.id, r.status)}
                              disabled
                              title="口コミの非公開機能は現在改修中です"
                              className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg border border-stone-200 text-stone-400 cursor-not-allowed"
                            >
                              改修中
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* ===== プロフィール設定タブ ===== */}
        {tab === 'settings' && (
          <div className="bg-stone-50 rounded-2xl shadow-sm border border-stone-200 p-6 space-y-6">

            {/* 顔写真 */}
            <div>
              <label className="text-xs text-gray-500 mb-2 block">顔写真</label>
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-full overflow-hidden bg-gray-100 flex items-center justify-center text-3xl shrink-0">
                  {imageUrl
                    ? <img src={imageUrl} alt="プロフィール" className="w-full h-full object-cover" />
                    : '👤'}
                </div>
                <label className={`cursor-pointer text-sm border border-stone-300 text-gray-600 hover:bg-stone-100 font-medium px-4 py-2 rounded-xl transition ${imageUploading ? 'opacity-50 pointer-events-none' : ''}`}>
                  {imageUploading ? 'アップロード中...' : '写真を選択'}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); e.target.value = '' }}
                  />
                </label>
              </div>
              <p className="text-xs text-gray-400 mt-1.5">JPG・PNG・WebP、500KB以内</p>
            </div>

            {/* 氏名 */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">姓</label>
                <input
                  value={form.family_name}
                  onChange={(e) => setForm((p: any) => ({ ...p, family_name: e.target.value }))}
                  className="w-full border border-stone-200 rounded-xl px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-300"
                  placeholder="山田"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">名</label>
                <input
                  value={form.given_name}
                  onChange={(e) => setForm((p: any) => ({ ...p, given_name: e.target.value }))}
                  className="w-full border border-stone-200 rounded-xl px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-300"
                  placeholder="太郎"
                />
              </div>
            </div>

            {/* 会社・部署 */}
            <div>
              <label className="text-xs text-gray-500 mb-1 block">会社名</label>
              <input
                value={form.company_name}
                onChange={(e) => setForm((p: any) => ({ ...p, company_name: e.target.value }))}
                className="w-full border border-stone-200 rounded-xl px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-300"
                placeholder="○○ハウス株式会社"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">所属・部署（任意）</label>
              <input
                value={form.department}
                onChange={(e) => setForm((p: any) => ({ ...p, department: e.target.value }))}
                className="w-full border border-stone-200 rounded-xl px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-300"
                placeholder="住宅営業部"
              />
            </div>

            {/* 自己紹介 */}
            <div>
              <label className="text-xs text-gray-500 mb-1 block">自己紹介</label>
              <textarea
                value={form.bio}
                onChange={(e) => setForm((p: any) => ({ ...p, bio: e.target.value }))}
                rows={4}
                className="w-full border border-stone-200 rounded-xl px-4 py-3 text-sm bg-white resize-none focus:outline-none focus:ring-2 focus:ring-orange-300"
                placeholder="お客様の理想の暮らしを一緒に実現します。"
              />
            </div>

            {/* 累計成約数 */}
            <div>
              <label className="text-xs text-gray-500 mb-1 block">累計成約数（棟）</label>
              <input
                type="number"
                value={form.contract_count}
                onChange={(e) => setForm((p: any) => ({ ...p, contract_count: e.target.value }))}
                className="w-40 border border-stone-200 rounded-xl px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-300"
                placeholder="50"
                min={0}
              />
            </div>

            {/* コアエリア */}
            <div>
              <label className="text-xs text-gray-500 mb-2 block">コアエリア（市区町村）</label>
              <div className="flex gap-2 mb-2">
                <select
                  value={corePrefecture}
                  onChange={(e) => { setCorePrefecture(e.target.value); setForm((p: any) => ({ ...p, core_city: '' })) }}
                  className="flex-1 border border-stone-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-300"
                >
                  <option value="">都道府県を選択</option>
                  {PREFECTURES.map((pref) => (
                    <option key={pref} value={pref}>{pref}</option>
                  ))}
                </select>
                <select
                  value={form.core_city}
                  onChange={(e) => setForm((p: any) => ({ ...p, core_city: e.target.value }))}
                  disabled={!corePrefecture}
                  className="flex-1 border border-stone-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-300 disabled:opacity-50"
                >
                  <option value="">市区町村を選択</option>
                  {(MUNICIPALITIES[corePrefecture] ?? []).map((city) => (
                    <option key={city} value={city}>{city}</option>
                  ))}
                </select>
              </div>
              {form.core_city && (
                <p className="text-xs text-orange-600 font-medium">選択中: {form.core_city}</p>
              )}
            </div>

            {/* 対応可能エリア（都道府県） */}
            <div>
              <label className="text-xs text-gray-500 mb-2 block">対応可能エリア（都道府県）</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {PREFECTURES.map((pref) => (
                  <button
                    key={pref}
                    onClick={() => toggleTag('available_prefectures', pref)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition ${
                      (form.available_prefectures ?? []).includes(pref)
                        ? 'bg-orange-500 text-white border-orange-500'
                        : 'bg-white text-gray-500 border-stone-200 hover:border-orange-300'
                    }`}
                  >
                    {pref}
                  </button>
                ))}
              </div>
            </div>

            {/* 得意分野 */}
            <div>
              <label className="text-xs text-gray-500 mb-2 block">得意分野</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {SPECIALTY_OPTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => toggleTag('specialty_styles', s)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition ${
                      (form.specialty_styles ?? []).includes(s)
                        ? 'bg-orange-500 text-white border-orange-500'
                        : 'bg-white text-gray-500 border-stone-200 hover:border-orange-300'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* 所持資格 */}
            <div>
              <label className="text-xs text-gray-500 mb-2 block">所持資格</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {QUALIFICATION_OPTIONS.map((q) => (
                  <button
                    key={q}
                    onClick={() => toggleTag('qualifications', q)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition ${
                      (form.qualifications ?? []).includes(q)
                        ? 'bg-blue-500 text-white border-blue-500'
                        : 'bg-white text-gray-500 border-stone-200 hover:border-blue-300'
                    }`}
                  >
                    {q}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  value={qualInput}
                  onChange={(e) => setQualInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { addCustomTag('qualifications', qualInput); setQualInput('') } }}
                  className="flex-1 border border-stone-200 rounded-xl px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-orange-300"
                  placeholder="その他を入力してEnter"
                />
              </div>
              {(form.qualifications ?? []).filter((q: string) => !QUALIFICATION_OPTIONS.includes(q)).map((q: string) => (
                <span key={q} className="inline-flex items-center gap-1 text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full mt-1 mr-1">
                  {q}
                  <button onClick={() => toggleTag('qualifications', q)} className="ml-0.5 hover:text-red-500">×</button>
                </span>
              ))}
            </div>

            {/* 得意分野（相談に乗りやすい分野） */}
            <div>
              <label className="text-xs text-gray-500 mb-1 block">得意分野（本人が選択した相談に乗りやすい分野）</label>
              <p className="text-xs text-gray-400 mb-3">最大{MAX_SPECIALTIES}つまで選択できます。</p>
              <div className="flex flex-wrap gap-2">
                {SPECIALTIES_OPTIONS.map((item) => {
                  const selected = (form.specialties ?? []).includes(item)
                  const atLimit = (form.specialties ?? []).length >= MAX_SPECIALTIES
                  return (
                    <button
                      key={item}
                      type="button"
                      onClick={() => {
                        setForm((prev: any) => {
                          const arr: string[] = prev.specialties ?? []
                          if (arr.includes(item)) return { ...prev, specialties: arr.filter((v: string) => v !== item) }
                          if (arr.length >= MAX_SPECIALTIES) return prev
                          return { ...prev, specialties: [...arr, item] }
                        })
                      }}
                      disabled={!selected && atLimit}
                      className={`px-3 py-2 rounded-xl text-xs border transition-colors ${
                        selected
                          ? 'bg-orange-500 text-white border-orange-500'
                          : atLimit
                          ? 'bg-stone-50 text-stone-300 border-stone-100 cursor-not-allowed'
                          : 'bg-white text-gray-500 border-stone-200 hover:border-orange-300'
                      }`}
                    >
                      {item}
                    </button>
                  )
                })}
              </div>
              <p className="text-xs text-gray-400 mt-2">{(form.specialties ?? []).length}/{MAX_SPECIALTIES}つ選択中</p>
            </div>

            {/* 会話スタイル */}
            <div>
              <label className="text-xs text-gray-500 mb-3 block">会話スタイル</label>
              <div className="space-y-4">
                {SALES_STYLE_AXES.map(({ key, left, right }) => {
                  const val = (form.sales_styles ?? {})[key] ?? 3
                  return (
                    <div key={key}>
                      <div className="flex justify-between text-xs text-stone-500 mb-2">
                        <span>{left}</span>
                        <span>{right}</span>
                      </div>
                      <input
                        type="range"
                        min={1}
                        max={6}
                        value={val}
                        onChange={(e) => setForm((p: any) => ({
                          ...p,
                          sales_styles: { ...(p.sales_styles ?? {}), [key]: Number(e.target.value) }
                        }))}
                        className="w-full accent-orange-500"
                      />
                    </div>
                  )
                })}
              </div>
            </div>

            {/* 保存 */}
            <div className="pt-2">
              {saveMsg && (
                <p className={`text-sm mb-3 ${saveMsg.includes('失敗') ? 'text-red-500' : 'text-green-600'}`}>
                  {saveMsg}
                </p>
              )}
              <button
                onClick={handleSaveSettings}
                disabled={saving}
                className="w-full bg-orange-500 hover:bg-orange-400 disabled:bg-orange-300 text-white font-bold py-3 rounded-xl transition text-sm"
              >
                {saving ? '保存中...' : '変更を保存する'}
              </button>
              {aiMsg && (
                <p className={`text-xs mt-2 ${aiMsg.includes('エラー') ? 'text-red-500' : 'text-gray-400'}`}>
                  {aiMsg}
                </p>
              )}
            </div>
          </div>
        )}

        {/* ===== 相談リクエストタブ ===== */}
        {tab === 'offers' && (
          <div className="space-y-4">
            {offersList.length === 0 ? (
              <div className="bg-stone-50 rounded-2xl shadow-sm border border-stone-200 p-10 text-center space-y-2">
                <p className="text-2xl">📬</p>
                <p className="text-sm font-bold text-gray-600">相談リクエストはまだありません</p>
                <p className="text-xs text-gray-400 leading-relaxed">
                  施主が「相談したい」を送信すると、ここに表示されます。
                </p>
              </div>
            ) : (
              offersList.map((o) => (
                <div key={o.id} className="bg-stone-50 rounded-2xl shadow-sm border border-stone-200 p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-bold text-gray-800">{o.contact_name}</p>
                      <p className="text-xs text-gray-500">{new Date(o.created_at).toLocaleDateString('ja-JP')}</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      o.status === 'new' ? 'bg-teal-100 text-teal-700' : 'bg-stone-100 text-stone-500'
                    }`}>
                      {o.status === 'new' ? '新着' : '対応済み'}
                    </span>
                  </div>
                  {(o.area || o.timing) && (
                    <div className="flex flex-wrap gap-3 text-xs text-gray-600">
                      {o.area && <span>📍 {o.area}</span>}
                      {o.timing && <span>🕐 {o.timing}</span>}
                    </div>
                  )}
                  <div className="bg-white rounded-xl border border-stone-100 px-4 py-3">
                    <p className="text-xs text-gray-400 mb-1">相談内容</p>
                    <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{o.message}</p>
                  </div>
                  <div className="bg-white rounded-xl border border-stone-100 px-4 py-3">
                    <p className="text-xs text-gray-400 mb-1">連絡先</p>
                    <p className="text-sm text-gray-700">{o.contact_email}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* ===== 施主プレビュータブ ===== */}
        {tab === 'preview' && (
          <div className="space-y-4">
            <div className="bg-stone-50 rounded-2xl shadow-sm border border-stone-200 p-6 text-center space-y-4">
              <span className="text-4xl block">👁️</span>
              <div>
                <p className="text-sm font-bold text-gray-700">施主に表示される画面を確認する</p>
                <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                  施主（購入検討者）がプロフィールページを開いたときの表示を確認できます。<br />
                  有料開示前の表示を確認できます。
                </p>
              </div>
              <Link
                href={`/salesperson/${profile.id}?preview=1`}
                className="block w-full bg-orange-500 hover:bg-orange-400 text-white font-bold py-3 rounded-xl transition text-sm"
              >
                プレビューを開く
              </Link>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              <p className="text-xs text-amber-700 leading-relaxed">
                プレビューは施主（未開示）の視点で表示されます。有料開示後のコンテンツ（実名・自己紹介・口コミ詳細）はプレビューには含まれません。
              </p>
            </div>
          </div>
        )}

      </div>

      {/* トリミングモーダル */}
      {cropSrc && (
        <div className="fixed inset-0 z-50 bg-black/80 flex flex-col">
          <div className="relative flex-1">
            <Cropper
              image={cropSrc}
              crop={crop}
              zoom={zoom}
              aspect={1}
              cropShape="round"
              showGrid={false}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
            />
          </div>
          <div className="bg-gray-900 px-6 py-5 space-y-3">
            <div className="flex items-center gap-3">
              <span className="text-white text-xs shrink-0">拡大</span>
              <input
                type="range"
                min={1}
                max={3}
                step={0.05}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="flex-1 accent-orange-500"
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { setCropSrc(null); URL.revokeObjectURL(cropSrc) }}
                className="flex-1 border border-gray-600 text-gray-300 font-medium py-3 rounded-xl text-sm"
              >
                キャンセル
              </button>
              <button
                onClick={handleCropConfirm}
                className="flex-1 bg-orange-500 hover:bg-orange-400 text-white font-bold py-3 rounded-xl text-sm"
              >
                この範囲で登録する
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
