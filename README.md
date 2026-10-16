# LatentShift URL Giveaway — basit çekiliş entegrasyonu

**Ne yapar?** Konferansın LinkedIn gönderi URL'sini alır, Apify üzerindeki yorum aktarıcısından yorumları ister, yorumcu profil kimliğine göre tekrarları kaldırır ve isimleri LatentShift CS kasa açma animasyonuna ekler. Varsayılan sağlayıcı HarvestAPI'dir. Resmî LinkedIn Developer uygulaması, OAuth veya tarayıcı eklentisi yoktur. Kasa açma efekti, konfeti, sahne modu ve manuel liste yükleme korunmuştur.

## 3 adımda kurulum

1. [Apify](https://console.apify.com/) hesabı açıp [HarvestAPI LinkedIn Post Comments](https://apify.com/harvestapi/linkedin-post-comments) aktörünü kullanabileceğinizden emin olun. Apify Console içinden **API & Integrations → API token** değerini alın.
2. `.env` dosyanız yoksa `.env.example` dosyasını `.env` adıyla kopyalayın. `APIFY_TOKEN=...` satırına Apify tokenınızı girin. Token değiştirince sunucuyu yeniden başlatın. **Tokenı HTML veya GitHub'a koymayın.**
3. Node.js 24+ kurulu bilgisayarda proje klasöründen `npm start` çalıştırıp `http://127.0.0.1:3000` adresine gidin. **LinkedIn URL** sekmesini açın, gönderi bağlantısını yapıştırın, **Yorumları getir** deyin.

**Kurulum için npm install gerekmez.** `npm test` yerel ve sahte API yanıtlarıyla testleri çalıştırır.

Sağlayıcı `.env` içindeki `APIFY_PROVIDER=harvestapi` ile seçilir; belirtilmezse HarvestAPI kullanılır. Aynı `APIFY_TOKEN` geçerlidir. `APIFY_PROVIDER=data-slayer` seçeneği de desteklenir. Sağlayıcı değişince sunucuyu yeniden başlatın; `/health` etkin sağlayıcıyı gösterir. Sağlayıcılar arasında otomatik ücretli tekrar denemesi yapılmaz. Mevcut gönderi önbelleği sağlayıcı değişiminden sonra da kullanılabilir.

16 Ekim 2026'daki Data Slayer hatasında `RUN_SUMMARY` kaydı `source_http_error` ve kaynak HTTP 402 döndürdü. Bu, aktörün kullandığı kaynaktaki bir hatadır; tek başına Apify hesabınızın bakiyesinin bittiğini göstermez. Bu nedenle varsayılan bağlantı HarvestAPI'ye alındı. HarvestAPI'de `profileScraperMode: short` kullanılır; ayrıca ücretlendirilen `main` profil zenginleştirmesi açılmaz. Gerçek çalıştırma fiyatını Apify Console'dan kontrol edin.

## Canlı etkinlik akışı

1. İlk kullanımda gönderi yorumlarını yükleyin. Sonraki açılışlarda kayıtlı katılımcılar, yorumlar, kazanan geçmişi ve ayarlar otomatik geri gelir; demo isimler bulunmaz.
2. Aktarım sonrası **İsim listesi** sekmesi otomatik açılır. Katılımcıları kontrol edin; LinkedIn'den gelen isimler düzenleme penceresinde de görünür ve kimlik/fotoğraf/yorum bilgisinin kaybolmaması için salt okunurdur.
3. Fotoğraf hazırlığının tamamlanmasını bekleyin. Yorumlar alınırken hareketli yükleme çubuğu, fotoğraflar hazırlanırken gerçek adet ilerlemesi gösterilir. Fotoğraflar altılı gruplar halinde indirilip çözülür; her denemede en fazla 12 saniye beklenir, başarısız yüklemeler kısa bir beklemeden sonra bir kez daha denenir. Tüm liste işlenir; 45 saniyeden sonra sıradaki fotoğrafları atlayan sınır kaldırılmıştır. Hazır fotoğraflar SQLite'ta saklanır ve sonraki açılışlarda yerelden sunulur. Yüklenemeyen fotoğrafların yerine ikon kullanılır; bu durum kimsenin katılımını etkilemez. Fotoğraf adresi hiç verilmemiş kişiler de katılmaya devam eder. **Fotoğrafları tekrar dene** yalnızca başarısız fotoğrafları yeniden dener; yorum servisini çalıştırmaz. Aktarım ve fotoğraf hazırlığı sırasında çekiliş düğmeleri kapalıdır.
4. **Kazananın yorumunu sahnede göster** ayarını seçin. Aynı kişinin birden fazla yorumu varsa servisten gelen ilk boş olmayan yorum gösterilir; uzun yorumlar sahnede üç satırla sınırlandırılır.
5. **Sahne modu** düğmesiyle tam ekrana geçin. Kontroller ve veri kaynağı panelleri gizlenir; fotoğraflar ve isimler büyür. **Boşluk** tuşuyla veya çekiliş düğmesiyle başlatın. **Esc** ile tam ekrandan çıkabilirsiniz.

Farklı bir gönderiye geçmek için **Katılımcı kaynağı → Sıfırla** düğmesini kullanın. Onaydan sonra aktif liste, gönderi adresi ve kazanan geçmişi temizlenir; LinkedIn URL sekmesi açılır. Temiz durum kaydedilir ve sayfa yenilenince eski liste geri gelmez. Önceki gönderilerin yorum ve fotoğraf önbelleği korunur. Aktarım, fotoğraf hazırlığı ve çekiliş sırasında sıfırlama kapalıdır.

**Kaydedildi** durumunda sayfayı yenileyebilir veya sunucuyu kapatıp açabilirsiniz. Katılımcılar, yorumlar, profil/fotoğraf adresleri, kazanan geçmişi ve ayarlar yerel `data/giveaway.sqlite` veritabanında saklanır. Veritabanı Node.js'in yerleşik SQLite desteğini kullanır; ek servis veya paket gerekmez. Tarayıcıda da son durumun bir kurtarma yedeği tutulur. Kayıt başarısızsa çekiliş durur ve **Tekrar dene** düğmesi görünür.

Aynı gönderiyi **Yorumları getir** ile açmak veritabanındaki sonucu kullanır; Apify tekrar çalışmaz. Takip parametreleri ve desteklenen aynı gönderiye ait URL biçimleri tek önbellek anahtarına çevrilir. Yeni yorumlar için **Yorumları güncelle** düğmesini kullanın: site içi onaydan sonra Apify tekrar çalışır ve kredi kullanır. Başarılı aktarım yeni katılımcı listesiyle kazanan geçmişini sıfırlar. Güncelleme başarısızsa eski kayıt korunur. Fotoğraf dosyaları `photos` tablosunda tutulur; aynı adrese gelen eşzamanlı istekler tek indirmeyi paylaşır. Fotoğraf yanıtı başına sınır 5 MB'tır. Henüz önbelleğe alınmamış bir adresin süresi dolmuşsa kişi ikonla gösterilir ve çekilişe katılmaya devam eder.

`data/`, SQLite dosyaları ve `.env` Git tarafından dışlanır. Yedek almak için sunucuyu kapatıp `data/giveaway.sqlite` dosyasını kopyalayın. Uygulama `npm start` ile yerel olarak çalışır; harici bir sunucuya yayınlama işlemi yapılmaz.

Bildirimler ve onaylar sayfanın ortasında gösterilir; tarayıcı `confirm`/`alert` pencereleri kullanılmaz. Onay pencerelerinde **Vazgeç**, **Esc** veya pencere dışına tıklama işlemi iptal eder. Kazanan geçmişini sıfırlama ve eksik katılımcı listesiyle devam etme bu pencerelerden onaylanır.

Her benzersiz katılımcı kazanmak için tek bir eşit olasılıklı indekse sahiptir. Aynı kişinin çok yorum yapması şansını artırmaz. Bekleme ekranında ve dönen kart sırasının tamamında her kimlik en fazla bir kez yer alır; az katılımcıda kart sayısı ve animasyon süresi azalır. Kazanan gösterilirken arkadaki kartlar gizlenir. Aynı ada sahip farklı LinkedIn kimlikleri ayrı katılımcı olarak korunur.

## Önemli sınırlamalar

- **Bu resmî LinkedIn API entegrasyonu değildir.** Apify üzerindeki bağımsız bir yorum çekme aracını kullanır; LinkedIn scraping işlemlerini kullanım şartlarında yasaklar. Hizmetin kullanılabilirliğini, bütün yorumları yüklemesini veya erişim kısıtlamalarına takılmamasını garanti edemeyiz. Kullanım ve kişisel veriler için organizatörün değerlendirme yapması gerekir.
- Yorumlar üçüncü taraf Apify/HarvestAPI (veya seçilen Data Slayer) servislerine gönderdiğiniz URL üzerinden aktarılır. Yalnızca herkese açık gönderiler desteklenir. LinkedIn şifreniz veya oturum çereziniz istenmez.
- `max_comments_per_post: 0` erişilebilir tüm ana yorumları ister; aktör gönderi başına **100 sayfa** sınırı uygular. Dönen ana yorum sayısı servisin bildirdiği `post_comment_count` değerinden azsa sistem eksiklik uyarısı verir. Bu karşılaştırma eksiksizlik garantisi değildir: sonuçları LinkedIn üzerindeki gönderi ve görünür yorumlarla karşılaştırın.
- HarvestAPI için `maxItems: 0` kullanılır; belgelenen sınır gönderi başına **100 sayfa × 10 ana yorumdur**. 1000 satıra ulaşılması eksiklik uyarısı oluşturur. Sağlayıcıların iç içe döndürdüğü yanıtlar çekilişe eklenmez.
- Yalnızca ana yorumların sahipleri çekilişe alınır. `top_replies` içindeki yanıtlar katılım sayılmaz; servis tüm yanıtları döndürmeyi garanti etmez.
- Servisin döndürdüğü LinkedIn profil fotoğrafları çekiliş kartlarında, katılımcı listesinde ve kazanan ekranında gösterilir. Fotoğraf yoksa veya yüklenmezse geometrik ikon kullanılır. Katılımcı listesindeki ve kazanan geçmişindeki isimlerden LinkedIn profiline gidilebilir. Yorumlar HTML olarak çalıştırılmaz; düz metin olarak gösterilir.
- Başlıktaki marka işareti ve sekme ikonu `https://latentshift.ai/favicon.svg` kaynağını kullanır; yüklenmesi internet bağlantısı gerektirir. Profil fotoğrafları da doğrudan LinkedIn görsel sunucularından yüklenir; yeniden aktarım yapıldığında fotoğraf adresleri yenilenir.
- Kararlı kimlik veya ad-soyad eksikse bunlar atlanır ve devam etmeden onay istenir. Benzersiz kimlik olarak LinkedIn üye ID'si veya profil URL'si kullanılır.
- Token yalnızca **yerel Node.js sunucusunda** tutulur, tarayıcıya verilmez. Bu sunucu sadece 127.0.0.1 adresinde dinler. İnternete açık ortam için kimlik doğrulama ve HTTPS güvenliği eklenmelidir.
- Apify kullanımının fiyatı ve kota koşulları servis sahibine bağlıdır; aktörün fiyatını çalıştırmadan kontrol edin.
- LinkedIn yorumları, katılımcı bilgileri ve çekiliş geçmişi bu bilgisayardaki SQLite veritabanında tutulur. API tokenı veritabanına yazılmaz. Dışarıdan gelen yorum listesinin doğruluğu henüz gerçek kimlik bilgisiyle test edilememiştir.

## Gerekli adresler

- Apify: https://console.apify.com/
- Varsayılan aktör ve fiyatlandırma: https://apify.com/harvestapi/linkedin-post-comments
- Alternatif aktör: https://apify.com/data-slayer/linkedin-post-comments
- LinkedIn scraping politikası: https://www.linkedin.com/help/linkedin/answer/a1341387/prohibition-of-scraping-software
