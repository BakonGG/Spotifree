import { Icon } from '../ui/Icon';
import { icons } from '../ui/icons';
import { useEffect, useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';

interface NavigationItem {
    id: string;
    href: string;
    label: string;
    icon: string;
    target?: '_blank';
}

function isCurrentPath(pathname: string, href: string) {
    if (href === '/') return pathname === '/' || pathname === '/home';
    return href.startsWith('/') && (pathname === href || pathname.startsWith(`${href}/`));
}

function usePathname() {
    const [pathname, setPathname] = useState(() => window.location.pathname);

    useEffect(() => {
        const update = () => setPathname(window.location.pathname);
        window.addEventListener('popstate', update);
        return () => window.removeEventListener('popstate', update);
    }, []);

    return pathname;
}

function NavigationList({ items, pathname }: { items: NavigationItem[]; pathname: string }) {
    return (
        <ul>
            {items.map((item) => {
                const active = isCurrentPath(pathname, item.href);
                return (
                    <li
                        className={`nav-item${active ? ' active' : ''}`}
                        id={item.id}
                        key={item.id}
                    >
                        <a
                            aria-current={active ? 'page' : undefined}
                            href={item.href}
                            id={item.id === 'sidebar-nav-party' ? 'sidebar-party-btn' : undefined}
                            rel={item.target ? 'noreferrer' : undefined}
                            target={item.target}
                        >
                            <Icon svg={item.icon} size={20} />
                            <span>{item.label}</span>
                        </a>
                    </li>
                );
            })}
        </ul>
    );
}

export function AppNavigation() {
    const pathname = usePathname();
    const { t } = useTranslation();

    const primaryItems: NavigationItem[] = [
        { id: 'sidebar-nav-home', href: '/', label: t('nav.home'), icon: icons.house },
        { id: 'sidebar-nav-library', href: '/library', label: t('nav.library'), icon: icons.library },
        { id: 'sidebar-nav-recent', href: '/recent', label: t('nav.recent'), icon: icons.recent },
        { id: 'sidebar-nav-unreleased', href: '/unreleased', label: t('nav.unreleased'), icon: icons.squares },
        { id: 'sidebar-nav-settings', href: '/settings', label: t('nav.settings'), icon: icons.settings },
    ];

    const secondaryItems: NavigationItem[] = [
        { id: 'sidebar-nav-party', href: '/parties', label: t('nav.parties'), icon: icons.users },
    ];

    return (
        <>
            <div className="sidebar-logo">
                <a aria-label="Spotyfree home" className="sidebar-logo-link" href="/">
                    <img
                        src="/assets/icone.png"
                        alt="Spotyfree"
                        className="app-logo"
                        width="28"
                        height="28"
                        style={{ objectFit: 'contain', borderRadius: '6px' }}
                    />
                    <span>Spotyfree</span>
                </a>
                <button
                    aria-label="Collapse sidebar"
                    className="btn-icon desktop-only"
                    id="sidebar-toggle"
                    title="Collapse sidebar"
                    type="button"
                >
                    <Icon svg={icons.chevronLeft} />
                </button>
            </div>

            <nav aria-label="Primary" className="sidebar-nav main">
                <NavigationList items={primaryItems} pathname={pathname} />
            </nav>

            <div className="sidebar-bottom-container">
                <nav
                    aria-label="Pinned music"
                    className="sidebar-nav"
                    id="pinned-items-nav"
                    style={{ display: 'none' }}
                >
                    <h2 className="pinned-items-header">Pinned</h2>
                    <ul id="pinned-items-list" />
                </nav>

                <div className="sidebar-nav-bottom">
                    <nav aria-label="More" className="sidebar-nav bottom">
                        <NavigationList items={secondaryItems} pathname={pathname} />
                    </nav>
                </div>
            </div>
        </>
    );
}
