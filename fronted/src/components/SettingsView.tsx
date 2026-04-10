import { useState, useEffect, type ReactElement } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  User, Shield, CreditCard, Palette, Key, Smartphone, Trash2,
  Globe, Clock, ChevronRight, Download,
  ReceiptText, ArrowLeft, Sparkles, Check, Loader2, AlertCircle, X,
} from 'lucide-react';
import defaultAvatarImage from '../../images/avatar.jpg';
import {
  fetchUserProfile, updateUserProfile, changePassword, deleteAccount,
  clearTokens, saveTokens, getTokens,
  type UserProfile,
} from '../api';

type SettingsTab = 'account' | 'privacy' | 'billing' | 'appearance';

interface SettingsViewProps {
  onBack: () => void;
  onLogout?: () => void;
}

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ${enabled ? 'bg-primary' : 'bg-surface-container-highest'}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition-transform duration-200 ${enabled ? 'translate-x-6' : 'translate-x-1'}`}
      />
    </button>
  );
}

function Toast({ message, type, onDismiss }: { message: string; type: 'success' | 'error'; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 3500);
    return () => clearTimeout(t);
  }, [onDismiss]);
  return (
    <motion.div
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      className={`fixed top-5 right-5 z-[100] flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg text-sm font-medium ${type === 'success' ? 'bg-white border border-green-200 text-green-700' : 'bg-white border border-red-200 text-red-600'}`}
    >
      {type === 'success' ? <Check className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
      <span>{message}</span>
      <button onClick={onDismiss} className="ml-2 opacity-50 hover:opacity-100 transition-opacity"><X className="w-3.5 h-3.5" /></button>
    </motion.div>
  );
}

function DeleteModal({ onConfirm, onCancel, loading }: { onConfirm: () => void; onCancel: () => void; loading: boolean }) {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-2xl p-8 max-w-sm w-full mx-4 shadow-2xl"
      >
        <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mb-4">
          <Trash2 className="w-6 h-6 text-red-600" />
        </div>
        <h3 className="text-lg font-bold text-on-surface mb-2">确认注销账户</h3>
        <p className="text-sm text-on-surface-variant leading-relaxed mb-6">
          此操作将停用您的账户，无法撤销。您的所有数据将被保留但账号将无法登录。
        </p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 py-2.5 rounded-lg border border-outline-variant/30 text-sm font-medium text-on-surface hover:bg-surface-container-low transition-colors disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 py-2.5 rounded-lg bg-red-600 text-white text-sm font-bold hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            确认注销
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function AccountTab({ onLogout }: { onLogout?: () => void }) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);

  const [pwOpen, setPwOpen] = useState(false);
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwSaving, setPwSaving] = useState(false);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [twoFA, setTwoFA] = useState(false);

  const showToast = (message: string, type: 'success' | 'error') => setToast({ message, type });

  useEffect(() => {
    fetchUserProfile()
      .then((p) => {
        setProfile(p);
        setName(p.username);
        setEmail(p.email ?? '');
      })
      .catch(() => showToast('加载用户信息失败', 'error'))
      .finally(() => setLoading(false));
  }, []);

  const handleSaveProfile = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const updated = await updateUserProfile({
        username: name.trim(),
        email: email.trim() || undefined,
      });
      setProfile(updated);
      const tokens = getTokens();
      if (tokens) saveTokens({ ...tokens, username: updated.username });
      showToast('资料已更新', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '保存失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (!oldPw || !newPw) return showToast('请填写所有密码字段', 'error');
    if (newPw !== confirmPw) return showToast('两次输入的新密码不一致', 'error');
    if (newPw.length < 6) return showToast('新密码至少需要6位', 'error');
    setPwSaving(true);
    try {
      await changePassword(oldPw, newPw);
      showToast('密码已更新', 'success');
      setPwOpen(false);
      setOldPw(''); setNewPw(''); setConfirmPw('');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '密码修改失败', 'error');
    } finally {
      setPwSaving(false);
    }
  };

  const handleDeleteAccount = async () => {
    setDeleting(true);
    try {
      await deleteAccount();
      clearTokens();
      onLogout?.();
    } catch (err) {
      showToast(err instanceof Error ? err.message : '注销失败', 'error');
      setDeleting(false);
      setShowDeleteModal(false);
    }
  };

  const Skeleton = () => (
    <div className="animate-pulse space-y-4">
      <div className="h-6 w-40 bg-surface-container-high rounded" />
      <div className="h-5 w-56 bg-surface-container rounded" />
    </div>
  );

  return (
    <div className="space-y-16">
      <AnimatePresence>
        {toast && <Toast key="toast" message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}
      </AnimatePresence>
      {showDeleteModal && (
        <DeleteModal
          onConfirm={handleDeleteAccount}
          onCancel={() => setShowDeleteModal(false)}
          loading={deleting}
        />
      )}

      {/* Profile */}
      <section className="grid grid-cols-1 md:grid-cols-12 gap-8 items-start">
        <div className="md:col-span-4">
          <h2 className="font-headline text-2xl font-bold tracking-tight text-on-surface mb-2">个人资料</h2>
          <p className="text-on-surface-variant text-sm leading-relaxed">管理您的公开身份以及联系方式。</p>
          {profile && (
            <p className="text-[11px] text-outline mt-3">注册于 {new Date(profile.created_at).toLocaleDateString('zh-CN')}</p>
          )}
        </div>
        <div className="md:col-span-8">
          <div className="bg-white/70 backdrop-blur-xl rounded-xl p-8 shadow-[0_4px_24px_rgba(87,94,112,0.06)]">
            {loading ? (
              <Skeleton />
            ) : (
              <div className="flex flex-col sm:flex-row gap-8 items-start">
                <div className="relative shrink-0">
                  <div className="w-20 h-20 rounded-full bg-surface-container-high ring-4 ring-white shadow-sm flex items-center justify-center overflow-hidden">
                    {profile?.avatar_url ? (
                      <img
                        src={profile.avatar_url}
                        alt={name}
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <img
                        src={defaultAvatarImage}
                        alt="默认头像"
                        className="w-full h-full object-cover"
                      />
                    )}
                  </div>
                </div>
                <div className="flex-1 space-y-5 w-full">
                  <div className="border-b border-outline-variant/30 pb-2 hover:border-primary/40 transition-colors">
                    <label className="block text-[10px] uppercase tracking-widest text-on-surface-variant mb-1">用户名</label>
                    <input
                      className="w-full bg-transparent border-none p-0 text-lg font-medium focus:ring-0 text-on-surface outline-none"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>
                  <div className="border-b border-outline-variant/30 pb-2 hover:border-primary/40 transition-colors">
                    <label className="block text-[10px] uppercase tracking-widest text-on-surface-variant mb-1">邮箱地址</label>
                    <input
                      type="email"
                      className="w-full bg-transparent border-none p-0 text-base focus:ring-0 text-on-surface-variant outline-none"
                      value={email}
                      placeholder="未绑定邮箱"
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                  <button
                    onClick={handleSaveProfile}
                    disabled={saving || !name.trim()}
                    className="flex items-center gap-2 px-5 py-2 bg-primary text-on-primary text-sm font-medium rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                    保存更改
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Preferences */}
      <section className="grid grid-cols-1 md:grid-cols-12 gap-8 items-start">
        <div className="md:col-span-4">
          <h2 className="font-headline text-2xl font-bold tracking-tight text-on-surface mb-2">偏好设置</h2>
          <p className="text-on-surface-variant text-sm leading-relaxed">个性化您的工作空间体验。</p>
        </div>
        <div className="md:col-span-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-white/70 backdrop-blur-xl p-6 rounded-xl flex flex-col gap-4 hover:bg-surface-container-low transition-colors cursor-pointer">
            <div className="flex justify-between items-start">
              <div className="w-10 h-10 rounded-lg bg-surface-container flex items-center justify-center">
                <Globe className="w-5 h-5 text-on-surface-variant" />
              </div>
              <ChevronRight className="w-4 h-4 text-outline-variant" />
            </div>
            <div>
              <h3 className="font-medium text-on-surface text-sm">显示语言</h3>
              <p className="text-xs text-on-surface-variant mt-1">简体中文 (中国)</p>
            </div>
          </div>
          <div className="bg-white/70 backdrop-blur-xl p-6 rounded-xl flex flex-col gap-4 hover:bg-surface-container-low transition-colors cursor-pointer">
            <div className="flex justify-between items-start">
              <div className="w-10 h-10 rounded-lg bg-surface-container flex items-center justify-center">
                <Clock className="w-5 h-5 text-on-surface-variant" />
              </div>
              <ChevronRight className="w-4 h-4 text-outline-variant" />
            </div>
            <div>
              <h3 className="font-medium text-on-surface text-sm">时区设置</h3>
              <p className="text-xs text-on-surface-variant mt-1">(GMT+08:00) 中国标准时间</p>
            </div>
          </div>
        </div>
      </section>

      {/* Security */}
      <section className="grid grid-cols-1 md:grid-cols-12 gap-8 items-start">
        <div className="md:col-span-4">
          <h2 className="font-headline text-2xl font-bold tracking-tight text-on-surface mb-2">安全</h2>
          <p className="text-on-surface-variant text-sm leading-relaxed">保护您的账户访问权限。</p>
        </div>
        <div className="md:col-span-8 space-y-4">
          <div className="bg-white/70 backdrop-blur-xl rounded-xl overflow-hidden">
            {/* Change Password Row — hidden for OAuth users */}
            {(profile?.auth_provider ?? 'password') === 'password' && <div className="border-b border-surface-container">
              <div className="p-5 flex items-center justify-between">
                <div className="flex gap-4 items-center">
                  <Key className="w-5 h-5 text-on-surface-variant shrink-0" />
                  <div>
                    <p className="text-sm font-medium">更改密码</p>
                    <p className="text-xs text-on-surface-variant">定期更换密码可提升账户安全性</p>
                  </div>
                </div>
                <button
                  onClick={() => setPwOpen((o) => !o)}
                  className="text-sm font-semibold text-primary hover:opacity-70 transition-opacity shrink-0"
                >
                  {pwOpen ? '收起' : '更新'}
                </button>
              </div>
              <AnimatePresence>
                {pwOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="px-5 pb-5 space-y-3 border-t border-surface-container-low pt-4">
                      {[
                        { label: '当前密码', value: oldPw, onChange: setOldPw },
                        { label: '新密码', value: newPw, onChange: setNewPw },
                        { label: '确认新密码', value: confirmPw, onChange: setConfirmPw },
                      ].map(({ label, value, onChange }) => (
                        <div key={label}>
                          <label className="block text-[10px] uppercase tracking-widest text-on-surface-variant mb-1">{label}</label>
                          <input
                            type="password"
                            value={value}
                            onChange={(e) => onChange(e.target.value)}
                            className="w-full bg-surface-container-low border-none rounded-lg px-3 py-2 text-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/20"
                          />
                        </div>
                      ))}
                      <button
                        onClick={handleChangePassword}
                        disabled={pwSaving}
                        className="mt-1 flex items-center gap-2 px-5 py-2 bg-primary text-on-primary text-sm font-medium rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
                      >
                        {pwSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                        确认修改
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>}
            {/* 2FA Row */}
            <div className="p-5 flex items-center justify-between">
              <div className="flex gap-4 items-center">
                <Smartphone className="w-5 h-5 text-on-surface-variant" />
                <div>
                  <p className="text-sm font-medium">双重身份验证 (2FA)</p>
                  <p className="text-xs text-on-surface-variant">通过手机应用接收验证码</p>
                </div>
              </div>
              <Toggle enabled={twoFA} onChange={() => setTwoFA(!twoFA)} />
            </div>
          </div>

          {/* Danger Zone */}
          <div className="bg-red-50/60 rounded-xl p-6 flex items-center justify-between">
            <div>
              <h3 className="text-red-600 font-medium text-sm">注销账户</h3>
              <p className="text-xs text-red-400 mt-1">此操作将停用账户，无法撤销。</p>
            </div>
            <button
              onClick={() => setShowDeleteModal(true)}
              className="px-4 py-2 text-xs font-bold text-red-600 border border-red-200 rounded-lg hover:bg-red-600 hover:text-white transition-all flex items-center gap-2"
            >
              <Trash2 className="w-3.5 h-3.5" />
              注销账户
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function AppearanceTab() {
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('light');
  const [fontSize, setFontSize] = useState<'sm' | 'md' | 'lg'>('md');
  const [adaptiveContrast, setAdaptiveContrast] = useState(true);

  const themes: { key: 'light' | 'dark' | 'system'; label: string; preview: ReactElement }[] = [
    {
      key: 'light',
      label: '浅色模式',
      preview: (
        <div className="w-full h-full bg-white p-4 flex flex-col gap-2">
          <div className="h-3 w-2/3 bg-zinc-100 rounded" />
          <div className="h-3 w-full bg-zinc-50 rounded" />
          <div className="h-16 w-full bg-zinc-100/50 rounded mt-auto" />
        </div>
      ),
    },
    {
      key: 'dark',
      label: '深色模式',
      preview: (
        <div className="w-full h-full bg-zinc-900 p-4 flex flex-col gap-2 relative">
          <div className="h-3 w-2/3 bg-zinc-800 rounded" />
          <div className="h-3 w-full bg-zinc-800/50 rounded" />
          <div className="h-16 w-full bg-zinc-800/30 rounded mt-auto" />
          <div className="absolute inset-0 bg-gradient-to-tr from-primary/10 to-transparent" />
        </div>
      ),
    },
    {
      key: 'system',
      label: '跟随系统',
      preview: (
        <div className="w-full h-full flex">
          <div className="w-1/2 bg-white p-4"><div className="h-3 w-full bg-zinc-100 rounded" /></div>
          <div className="w-1/2 bg-zinc-900 p-4"><div className="h-3 w-full bg-zinc-800 rounded" /></div>
        </div>
      ),
    },
  ];

  const fontSizes = [
    { key: 'sm' as const, label: '小 (12px)' },
    { key: 'md' as const, label: '中 (14px) · 推荐' },
    { key: 'lg' as const, label: '大 (16px)' },
  ];

  return (
    <div className="space-y-12">
      <header>
        <h2 className="text-3xl font-headline font-extrabold tracking-tight text-on-surface mb-2 italic">外观设置</h2>
        <p className="text-on-surface-variant">自定义您的工作区显示风格。</p>
      </header>

      {/* Theme selection */}
      <section>
        <label className="block text-xs font-bold tracking-widest uppercase text-on-surface-variant mb-6">主题模式</label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          {themes.map(({ key, label, preview }) => (
            <div
              key={key}
              className="group relative cursor-pointer active:scale-[0.98] transition-all"
              onClick={() => setTheme(key)}
            >
              <div className={`aspect-[4/3] rounded-xl overflow-hidden shadow-sm transition-all duration-300 ${theme === key ? 'ring-2 ring-primary border-2 border-primary/40 shadow-xl' : 'border border-outline-variant/20 hover:border-primary/20'}`}>
                {preview}
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span className={`text-sm ${theme === key ? 'font-bold text-primary' : 'font-medium text-on-surface'}`}>{label}</span>
                <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors ${theme === key ? 'border-primary bg-primary' : 'border-outline-variant hover:border-primary'}`}>
                  {theme === key && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Font size & scaling */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 items-start">
        <section className="lg:col-span-3 bg-surface-container-low rounded-2xl p-8">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h3 className="font-bold text-lg">界面缩放</h3>
              <p className="text-sm text-on-surface-variant">调整整体界面的显示密度</p>
            </div>
            <span className="text-2xl font-headline font-black text-primary">100%</span>
          </div>
          <div className="relative w-full h-12 flex items-center">
            <div className="absolute w-full h-1.5 bg-surface-container-highest rounded-full" />
            <div className="absolute w-1/2 h-1.5 bg-primary rounded-full" />
            <input type="range" min={75} max={150} defaultValue={100} className="absolute w-full appearance-none bg-transparent cursor-pointer" />
          </div>
          <div className="flex justify-between mt-2 text-[10px] text-outline uppercase font-bold tracking-tighter">
            <span>默认</span><span>最大</span>
          </div>
        </section>
        <section className="lg:col-span-2 bg-surface-container-low rounded-2xl p-8">
          <h3 className="font-bold text-lg mb-6">字体大小</h3>
          <div className="space-y-3">
            {fontSizes.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setFontSize(key)}
                className={`w-full flex items-center justify-between p-3 rounded-lg text-left transition-colors ${fontSize === key ? 'bg-surface-container-lowest shadow-sm' : 'hover:bg-surface-container-high'}`}
              >
                <span className={`text-sm ${fontSize === key ? 'font-bold text-primary' : 'font-medium'}`}>{label}</span>
                {fontSize === key && <Check className="w-4 h-4 text-primary" />}
              </button>
            ))}
          </div>
        </section>
      </div>

      {/* Smart adaptive banner */}
      <section className="rounded-3xl bg-white/30 p-1 border border-white/20">
        <div className="flex items-center justify-between p-7 bg-gradient-to-r from-primary to-primary-dim rounded-[22px] text-on-primary shadow-2xl">
          <div className="flex items-center gap-5">
            <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center backdrop-blur-md">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <h4 className="font-headline text-lg font-bold">智能自适应</h4>
              <p className="text-white/70 text-sm">根据光线环境自动调节对比度</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs font-bold uppercase tracking-widest opacity-60">{adaptiveContrast ? '已启用' : '已禁用'}</span>
            <Toggle enabled={adaptiveContrast} onChange={() => setAdaptiveContrast(!adaptiveContrast)} />
          </div>
        </div>
      </section>
    </div>
  );
}

function PrivacyTab() {
  const [incognito, setIncognito] = useState(true);

  return (
    <div className="space-y-12">
      <header>
        <h2 className="text-3xl font-headline font-bold tracking-tight text-on-surface mb-3">隐私设置</h2>
        <p className="text-on-surface-variant text-base max-w-2xl leading-relaxed">
          保护您的数字足迹。管理数据可见性、导出个人信息以及加强账户的安全防线。
        </p>
      </header>

      <div className="grid grid-cols-12 gap-6">
        {/* Incognito Mode */}
        <div className="col-span-12 md:col-span-7 bg-white/70 backdrop-blur-xl rounded-xl p-8 flex flex-col justify-between shadow-[0px_12px_40px_rgba(45,51,56,0.06)]">
          <div>
            <div className="flex justify-between items-start mb-10">
              <div>
                <h3 className="text-xl font-headline font-semibold">隐身模式</h3>
                <p className="text-sm text-on-surface-variant mt-1">启用后，您的活动将不会同步到分析平台。</p>
              </div>
              <Toggle enabled={incognito} onChange={() => setIncognito(!incognito)} />
            </div>
            <div className="space-y-3">
              {['匿名化元数据处理', '加密的会话令牌'].map((item) => (
                <div key={item} className="flex items-center gap-3 text-sm text-on-surface-variant">
                  <Check className="w-4 h-4 text-primary" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-10 pt-6 border-t border-surface-container-high">
            <span className="text-xs uppercase tracking-widest text-on-surface-variant font-bold">
              当前状态：{incognito ? '受保护' : '未启用'}
            </span>
          </div>
        </div>

        {/* 2FA Promo */}
        <div className="col-span-12 md:col-span-5 bg-primary rounded-xl p-8 text-on-primary relative overflow-hidden flex flex-col justify-end min-h-[280px]">
          <div className="absolute top-4 right-4 opacity-10">
            <Shield className="w-28 h-28" />
          </div>
          <h3 className="text-2xl font-headline font-bold mb-3">双重身份验证</h3>
          <p className="text-sm text-white/80 mb-6">在登录时要求提供验证码，为账户多加一层保护。</p>
          <button className="w-full bg-white text-primary font-bold py-3 px-6 rounded-lg hover:opacity-90 transition-opacity active:scale-[0.98]">
            立即开启
          </button>
        </div>

        {/* Data Export */}
        <div className="col-span-12 md:col-span-4 bg-surface-container-low rounded-xl p-8 flex flex-col gap-6">
          <div className="w-12 h-12 bg-surface-container-high rounded-full flex items-center justify-center">
            <Download className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h4 className="font-headline font-semibold text-lg mb-2">数据导出</h4>
            <p className="text-xs text-on-surface-variant leading-relaxed">下载所有活动记录、设置和偏好的完整归档。处理可能需要几分钟。</p>
          </div>
          <button className="mt-auto text-primary font-bold text-sm flex items-center gap-2 hover:translate-x-1 transition-transform">
            请求下载 <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Privacy Info */}
        <div className="col-span-12 md:col-span-8 bg-surface-container-high rounded-xl p-10 flex flex-col justify-end min-h-[180px]">
          <h4 className="text-xl font-headline font-bold mb-2">您的隐私是我们的首要任务</h4>
          <p className="text-sm text-on-surface-variant">我们不会将您的旅行数据出售给第三方。所有行程信息均加密存储。</p>
          <div className="mt-6 flex gap-6">
            {['隐私政策', '服务条款', 'GDPR 合规性'].map((link) => (
              <a key={link} href="#" className="text-xs text-on-surface-variant hover:text-primary transition-colors">{link}</a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function BillingTab() {
  const invoices = [
    { date: '2024年03月12日', amount: '¥128.00' },
    { date: '2024年02月12日', amount: '¥128.00' },
    { date: '2024年01月12日', amount: '¥128.00' },
  ];

  return (
    <div className="space-y-10">
      <header>
        <h2 className="text-3xl font-headline font-bold tracking-tight text-on-surface mb-2">订阅与支付</h2>
        <p className="text-on-surface-variant">管理您的订阅计划、支付方式以及查看过往账单明细。</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Current Plan */}
        <div className="lg:col-span-8 bg-surface-container-low p-8 rounded-xl flex flex-col justify-between min-h-[200px]">
          <div>
            <div className="flex items-center gap-2 mb-5">
              <span className="px-2 py-1 bg-primary text-on-primary text-[10px] font-bold tracking-widest rounded">CURRENT PLAN</span>
            </div>
            <h3 className="font-headline text-4xl font-extrabold text-on-surface tracking-tighter">Premium</h3>
            <p className="mt-3 text-on-surface-variant text-sm">您的订阅将于 2024年12月12日 自动续费。</p>
          </div>
          <div className="mt-8 flex items-center gap-3">
            <button className="bg-gradient-to-br from-primary to-primary-dim text-on-primary px-5 py-2.5 rounded-lg text-sm font-medium hover:opacity-90 transition-all active:scale-[0.98]">
              升级计划
            </button>
            <button className="bg-surface-container-high text-on-surface px-5 py-2.5 rounded-lg text-sm font-medium hover:opacity-90 transition-all active:scale-[0.98]">
              取消订阅
            </button>
          </div>
        </div>

        {/* Payment Method */}
        <div className="lg:col-span-4 bg-white/70 backdrop-blur-xl p-8 rounded-xl shadow-[0px_4px_20px_rgba(45,51,56,0.04)] flex flex-col">
          <h4 className="font-headline text-lg font-bold mb-6">支付方式</h4>
          <div className="mt-auto">
            <div className="flex items-center gap-4 p-4 bg-surface-container-low rounded-lg mb-5">
              <div className="w-12 h-8 bg-on-surface flex items-center justify-center rounded text-white font-bold italic text-xs">VISA</div>
              <div>
                <p className="text-sm font-bold">Visa **** 8899</p>
                <p className="text-xs text-on-surface-variant">过期时间 12/26</p>
              </div>
            </div>
            <a href="#" className="text-sm font-semibold text-primary hover:underline decoration-2 underline-offset-4 flex items-center gap-1">
              更新支付信息 <ChevronRight className="w-4 h-4" />
            </a>
          </div>
        </div>

        {/* Billing History */}
        <div className="lg:col-span-12 bg-surface-container-low/60 p-8 rounded-xl">
          <div className="flex items-center justify-between mb-6">
            <h4 className="font-headline text-lg font-bold">账单历史</h4>
            <button className="text-xs font-semibold text-on-surface-variant hover:text-on-surface transition-colors flex items-center gap-1">
              <Download className="w-4 h-4" /> 导出全部
            </button>
          </div>
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="text-on-surface-variant border-b border-outline-variant/10">
                <th className="pb-4 font-medium">日期</th>
                <th className="pb-4 font-medium">金额</th>
                <th className="pb-4 font-medium">状态</th>
                <th className="pb-4 text-right font-medium">发票</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map(({ date, amount }) => (
                <tr key={date} className="border-b border-outline-variant/5 hover:bg-surface-container-high/40 transition-colors">
                  <td className="py-4 font-medium">{date}</td>
                  <td className="py-4">{amount}</td>
                  <td className="py-4">
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-[10px] font-bold">
                      <span className="w-1 h-1 rounded-full bg-green-600" />
                      已支付
                    </span>
                  </td>
                  <td className="py-4 text-right">
                    <button className="text-on-surface-variant hover:text-on-surface transition-colors">
                      <ReceiptText className="w-4 h-4 inline" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const tabs: { key: SettingsTab; label: string; icon: ReactElement }[] = [
  { key: 'account', label: 'Account', icon: <User className="w-4 h-4" /> },
  { key: 'privacy', label: 'Privacy', icon: <Shield className="w-4 h-4" /> },
  { key: 'billing', label: 'Billing', icon: <CreditCard className="w-4 h-4" /> },
  { key: 'appearance', label: 'Appearance', icon: <Palette className="w-4 h-4" /> },
];

export function SettingsView({ onBack, onLogout }: SettingsViewProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('account');
  const storedUsername = getTokens()?.username ?? '用户';

  const content: Record<SettingsTab, ReactElement> = {
    account: <AccountTab onLogout={onLogout} />,
    privacy: <PrivacyTab />,
    billing: <BillingTab />,
    appearance: <AppearanceTab />,
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="min-h-screen bg-surface flex"
    >
      {/* Settings Sidebar */}
      <aside className="hidden md:flex flex-col w-56 shrink-0 py-8 px-4 bg-surface-container-low border-r border-outline-variant/10 min-h-screen sticky top-0 self-start">
        <div className="px-4 mb-8">
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-on-surface-variant hover:text-on-surface text-xs font-medium transition-colors mb-6"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            返回
          </button>
          <h1 className="text-base font-semibold tracking-tight text-on-surface">Settings</h1>
          <p className="text-xs text-on-surface-variant mt-0.5 opacity-70">Manage your workspace</p>
        </div>
        <nav className="flex-1 space-y-1">
          {tabs.map(({ key, label, icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg transition-colors duration-200 text-sm ${
                activeTab === key
                  ? 'bg-surface-container-highest text-on-surface font-bold'
                  : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
              }`}
            >
              {icon}
              <span>{label}</span>
            </button>
          ))}
        </nav>
        
      </aside>

      {/* Mobile tab bar */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/90 backdrop-blur-xl border-t border-outline-variant/10 flex">
        {tabs.map(({ key, label, icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex-1 flex flex-col items-center gap-1 py-3 text-[10px] transition-colors ${
              activeTab === key ? 'text-primary font-bold' : 'text-on-surface-variant'
            }`}
          >
            {icon}
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto pb-24 md:pb-0">
        {/* Top bar */}
        <header className="sticky top-0 z-30 h-14 flex items-center justify-end px-8 bg-white/70 backdrop-blur-xl shadow-sm">
          <div className="flex items-center gap-4">
            {/* mobile back */}
            <button
              onClick={onBack}
              className="md:hidden flex items-center gap-1.5 text-on-surface-variant hover:text-on-surface text-xs font-medium transition-colors mr-auto absolute left-4"
            >
              <ArrowLeft className="w-4 h-4" />
              返回
            </button>
            <span className="text-sm font-bold tracking-tight text-on-surface-variant">个人设置</span>
          </div>
        </header>

        <div className="max-w-4xl mx-auto px-6 md:px-12 py-12">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
            >
              {content[activeTab]}
            </motion.div>
          </AnimatePresence>
        </div>

        <footer className="px-12 pb-10 text-center">
          <p className="text-[10px] text-on-surface-variant opacity-40 uppercase tracking-[0.2em]">OpenClaw Travel v1.0 • 2024</p>
        </footer>
      </main>
    </motion.div>
  );
}
