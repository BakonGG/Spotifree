import { useTranslation } from 'react-i18next';

const tabs = [
    { id: 'tracks', labelKey: 'search.tracks', fallback: 'Tracks', layout: 'track-list' },
    { id: 'albums', labelKey: 'search.albums', fallback: 'Albums', layout: 'card-grid' },
    { id: 'artists', labelKey: 'search.artists', fallback: 'Artists', layout: 'card-grid' },
    { id: 'playlists', labelKey: 'search.playlists', fallback: 'Playlists', layout: 'card-grid' },
    { id: 'podcasts', labelKey: 'search.podcasts', fallback: 'Podcasts', layout: 'card-grid' },
] as const;

export function SearchPage() {
    const { t } = useTranslation();

    return (
        <>
            <h1 className="section-title" id="search-results-title">
                {t('search.resultsTitle', 'Search results')}
            </h1>
            <div aria-label="Search result types" className="search-tabs" role="tablist">
                {tabs.map((tab, index) => (
                    <button
                        aria-controls={`search-tab-${tab.id}`}
                        aria-selected={index === 0 ? 'true' : 'false'}
                        className={`search-tab${index === 0 ? ' active' : ''}`}
                        data-tab={tab.id}
                        key={tab.id}
                        role="tab"
                        type="button"
                    >
                        {t(tab.labelKey, tab.fallback)}
                    </button>
                ))}
            </div>
            {tabs.map((tab, index) => (
                <div
                    aria-hidden={index === 0 ? 'false' : 'true'}
                    className={`search-tab-content${index === 0 ? ' active' : ''}`}
                    id={`search-tab-${tab.id}`}
                    key={tab.id}
                    role="tabpanel"
                >
                    <div className={tab.layout} id={`search-${tab.id}-container`} />
                </div>
            ))}
        </>
    );
}
