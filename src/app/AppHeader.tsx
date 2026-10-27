import { Icon } from '../ui/Icon';
import { icons } from '../ui/icons';
import { useTranslation } from 'react-i18next';
import { setLanguage } from '../i18n';

export function AppHeader() {
    const { t, i18n } = useTranslation();
    const currentLang = i18n.language?.startsWith('pt') ? 'pt-BR' : 'en';

    const toggleLang = () => {
        const nextLang = currentLang === 'pt-BR' ? 'en' : 'pt-BR';
        setLanguage(nextLang);
    };

    return (
        <>
            <div className="navigation-controls desktop-only">
                <button aria-label={t('common.close')} className="nav-btn" id="nav-back" title="Go back" type="button">
                    <Icon svg={icons.chevronLeft} />
                </button>
                <button aria-label="Go forward" className="nav-btn" id="nav-forward" title="Go forward" type="button">
                    <Icon svg={icons.chevronRight} />
                </button>
            </div>

            <button
                aria-label="Open navigation"
                className="hamburger-menu"
                id="hamburger-btn"
                title="Open navigation"
                type="button"
            >
                <Icon svg={icons.menu} />
            </button>

            <form className="search-bar" id="search-form" role="search">
                <Icon className="search-icon" svg={icons.search} />
                <label className="sr-only" htmlFor="search-input">
                    {t('search.label')}
                </label>
                <input
                    autoCapitalize="off"
                    autoComplete="off"
                    autoCorrect="off"
                    id="search-input"
                    placeholder={t('search.placeholder')}
                    spellcheck={false}
                    type="search"
                />
                <button
                    aria-label={t('search.clear')}
                    className="search-clear-btn btn-icon"
                    style={{ display: 'none' }}
                    title={t('search.clear')}
                    type="button"
                >
                    <span aria-hidden="true">×</span>
                </button>
                <div
                    aria-label={t('search.history')}
                    className="search-history"
                    id="search-history"
                    style={{ display: 'none' }}
                />
            </form>

            <div style={{ display: 'flex', alignItems: 'center', marginLeft: 'auto', gap: '8px' }}>
                <button
                    aria-label={currentLang === 'pt-BR' ? 'Mudar para Inglês' : 'Switch to Portuguese'}
                    className="lang-switcher-btn"
                    id="header-lang-btn"
                    onClick={toggleLang}
                    title={currentLang === 'pt-BR' ? 'Mudar para Inglês' : 'Switch to Portuguese'}
                    type="button"
                    style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        padding: '4px 10px',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        borderRadius: '20px',
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        backgroundColor: 'rgba(255, 255, 255, 0.08)',
                        color: 'var(--foreground, #fff)',
                        cursor: 'pointer',
                        transition: 'background-color 0.2s',
                    }}
                >
                    <span style={{ fontSize: '1rem', lineHeight: 1 }}>{currentLang === 'pt-BR' ? '🇧🇷' : '🇺🇸'}</span>
                    <span>{currentLang === 'pt-BR' ? 'PT' : 'EN'}</span>
                </button>

                <div className="header-account-control">
                    <button aria-label={t('account.title')} className="btn-icon" id="header-account-btn" title={t('account.title')} type="button">
                        <span className="header-account-icon-wrap" id="header-account-icon">
                            <Icon svg={icons.user} />
                        </span>
                        <img
                            alt="Account avatar"
                            crossOrigin="anonymous"
                            id="header-account-img"
                            referrerPolicy="no-referrer"
                            style={{ display: 'none' }}
                        />
                    </button>
                    <div className="dropdown-menu" id="header-account-dropdown" />
                </div>
            </div>
        </>
    );
}
