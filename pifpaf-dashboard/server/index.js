const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { ApifyClient } = require('apify-client');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const PORT = process.env.PORT || 5000;
const APIFY_TOKEN = process.env.APIFY_TOKEN;

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 5432,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
});

const apifyClient = new ApifyClient({ token: APIFY_TOKEN });

async function initDB() {
  try {
    const checkColumn = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name='users' AND column_name='is_private'
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        instagram_username VARCHAR(255) UNIQUE,
        username VARCHAR(255),
        profile_pic TEXT,
        followers INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    if (checkColumn.rows.length === 0) {
      await pool.query(`
        ALTER TABLE users ADD COLUMN is_private BOOLEAN DEFAULT false
      `);
      console.log('✅ Добавлена колонка is_private');
    }
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS reels (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        instagram_id VARCHAR(255) UNIQUE,
        media_url TEXT,
        thumbnail_url TEXT,
        caption TEXT,
        view_count INTEGER DEFAULT 0,
        like_count INTEGER DEFAULT 0,
        comment_count INTEGER DEFAULT 0,
        timestamp TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ База данных готова');
  } catch (err) {
    console.error('❌ Ошибка инициализации БД:', err.message);
  }
}
initDB();

// ===== ПРОКСИ ДЛЯ ИЗОБРАЖЕНИЙ =====
app.get('/api/proxy-image', async (req, res) => {
  const imageUrl = req.query.url;
  
  if (!imageUrl) {
    return res.status(400).json({ error: 'URL не указан' });
  }
  
  try {
    const response = await axios({
      method: 'GET',
      url: imageUrl,
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
        'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
        'Referer': 'https://www.instagram.com/',
        'Origin': 'https://www.instagram.com',
      }
    });
    
    const contentType = response.headers['content-type'] || 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(response.data);
  } catch (error) {
    console.error('Прокси ошибка:', error.message);
    res.status(500).json({ error: 'Не удалось загрузить изображение' });
  }
});

// Получение всех рилсов
app.get('/api/reels', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        r.*, 
        u.instagram_username, 
        u.profile_pic, 
        u.followers,
        u.is_private
      FROM reels r 
      JOIN users u ON r.user_id = u.id 
      ORDER BY r.timestamp DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Получение списка пользователей
app.get('/api/users', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        id, 
        instagram_username, 
        username, 
        profile_pic, 
        followers,
        is_private,
        created_at
      FROM users 
      ORDER BY created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Проверка приватности
async function checkAccountPrivacy(username) {
  try {
    const run = await apifyClient.actor('apify/instagram-profile-scraper').call({
      usernames: [username],
    });
    const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();
    const profile = items[0];
    
    const isPrivate = profile.isPrivate === true || profile.is_private === true;
    return { isPrivate, profile };
  } catch (err) {
    console.error('Ошибка проверки приватности:', err.message);
    return { isPrivate: false, profile: null };
  }
}

// ===== НОВАЯ ФУНКЦИЯ - ИСПОЛЬЗУЕМ ДРУГОЙ АКТОР =====
async function getInstagramReels(username) {
  try {
    // Используем актор, который специально для рилсов
    console.log('🔄 Пробуем instagram-reels-scraper...');
    const run = await apifyClient.actor('apify/instagram-reels-scraper').call({
      username: username,
      resultsLimit: 30,
    });
    
    const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();
    if (items && items.length > 0) {
      console.log(`✅ instagram-reels-scraper вернул ${items.length} рилсов`);
      return { posts: items, usedActor: 'instagram-reels-scraper' };
    }
  } catch (err) {
    console.log('❌ instagram-reels-scraper не сработал:', err.message);
  }

  try {
    // Пробуем другой актор - Instagram Scraper с правильными параметрами
    console.log('🔄 Пробуем instagram-scraper (с username)...');
    const run = await apifyClient.actor('apify/instagram-scraper').call({
      username: username,  // пробуем singular
      resultsLimit: 30,
    });
    
    const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();
    if (items && items.length > 0 && !items[0]?.error) {
      console.log(`✅ instagram-scraper вернул ${items.length} постов`);
      return { posts: items, usedActor: 'instagram-scraper' };
    }
  } catch (err) {
    console.log('❌ instagram-scraper не сработал:', err.message);
  }

  try {
    // Пробуем Instagram Profile Scraper с расширенными настройками
    console.log('🔄 Пробуем instagram-profile-scraper (с постами)...');
    const run = await apifyClient.actor('apify/instagram-profile-scraper').call({
      usernames: [username],
      resultsLimit: 30,
      getPosts: true,  // запрашиваем посты
      getReels: true,  // запрашиваем рилсы
    });
    
    const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();
    if (items && items.length > 0) {
      // Ищем посты внутри профиля
      const posts = items[0]?.posts || items[0]?.reels || items;
      if (posts && posts.length > 0) {
        console.log(`✅ instagram-profile-scraper вернул ${posts.length} постов`);
        return { posts, usedActor: 'instagram-profile-scraper' };
      }
    }
  } catch (err) {
    console.log('❌ instagram-profile-scraper не сработал:', err.message);
  }

  return { posts: [], usedActor: null };
}

// ===== УЛУЧШЕННАЯ ФУНКЦИЯ ИЗВЛЕЧЕНИЯ ДАННЫХ =====
function extractVideoData(post) {
  // ===== 1. ИЗВЛЕКАЕМ ОБЛОЖКУ =====
  let thumbnail = '';
  
  const thumbnailFields = [
    post.displayUrl,
    post.display_url,
    post.thumbnailUrl,
    post.thumbnail_url,
    post.thumbnail,
    post.cover,
    post.cover_url,
    post.imageUrl,
    post.image_url,
    post.preview,
    post.preview_url,
    post.picture,
    post.picture_url,
    post.media_url,
    post.mediaUrl,
    post.video_thumbnail,
    post.videoThumbnail,
    post.image_versions2?.candidates?.[0]?.url,
    post.video_versions?.[0]?.url,
    post.carousel_media?.[0]?.image_versions2?.candidates?.[0]?.url,
    post.images?.[0]?.url,
    post.images?.standard_resolution?.url,
  ];

  for (const field of thumbnailFields) {
    if (field && typeof field === 'string' && field.startsWith('http')) {
      thumbnail = field;
      break;
    }
  }

  // ===== 2. ИЗВЛЕКАЕМ ОПИСАНИЕ =====
  let caption = '';
  if (post.caption) {
    if (typeof post.caption === 'string') caption = post.caption;
    else if (typeof post.caption === 'object' && post.caption.text) caption = post.caption.text;
  } else if (post.text) {
    caption = post.text;
  } else if (post.description) {
    caption = post.description;
  } else if (post.edge_media_to_caption?.edges?.[0]?.node?.text) {
    caption = post.edge_media_to_caption.edges[0].node.text;
  }

  // ===== 3. ИЗВЛЕКАЕМ ДАТУ =====
  let timestamp = new Date();
  if (post.timestamp) {
    timestamp = new Date(post.timestamp);
  } else if (post.createdAt) {
    timestamp = new Date(post.createdAt);
  } else if (post.takenAtTimestamp) {
    timestamp = new Date(post.takenAtTimestamp * 1000);
  } else if (post.date) {
    timestamp = new Date(post.date);
  } else if (post.created_time) {
    timestamp = new Date(post.created_time * 1000);
  }

  // ===== 4. ИЗВЛЕКАЕМ ВИДЕО =====
  const videoUrl = 
    post.videoUrl || 
    post.video_url || 
    post.video || 
    post.video_versions?.[0]?.url ||
    '';

  // ===== 5. ИЗВЛЕКАЕМ СТАТИСТИКУ =====
  const views = 
    post.videoViews || 
    post.video_play_count || 
    post.videoPlayCount || 
    post.playCount || 
    post.view_count || 
    post.views || 
    0;

  const likes = 
    post.likesCount || 
    post.like_count || 
    post.likes || 
    post.edge_media_preview_like?.count ||
    0;

  const comments = 
    post.commentsCount || 
    post.comment_count || 
    post.comments || 
    post.edge_media_to_comment?.count ||
    0;

  // ===== 6. ПРОВЕРЯЕМ, ЧТО ЭТО ВИДЕО =====
  const isVideo = 
    post.type === 'Video' || 
    post.type === 'video' ||
    post.mediaType === 'Video' ||
    post.mediaType === 'video' ||
    post.videoUrl || 
    post.video || 
    post.video_url ||
    post.isVideo === true ||
    post.is_video === true ||
    (post.media_type === 2) ||
    (post.media_type === 8) ||
    (post.video_versions && post.video_versions.length > 0) ||
    (post.videos && post.videos.length > 0) ||
    (post.__typename && post.__typename === 'GraphVideo');

  // Логируем для отладки
  if (thumbnail) {
    console.log(`  🖼️ Обложка: ${thumbnail.substring(0, 60)}...`);
  }
  if (caption) {
    console.log(`  📝 Описание: ${caption.substring(0, 50)}...`);
  }
  console.log(`  📅 Дата: ${timestamp.toISOString().split('T')[0]}`);
  console.log(`  👁️ Просмотры: ${views}, ❤️ Лайки: ${likes}, 💬 Комменты: ${comments}`);

  return {
    id: post.id || `post_${Date.now()}`,
    thumbnail,
    videoUrl,
    caption: caption || 'Без описания',
    views: parseInt(views) || 0,
    likes: parseInt(likes) || 0,
    comments: parseInt(comments) || 0,
    timestamp,
    isVideo,
    isMock: false
  };
}

// Синхронизация
app.post('/api/sync/:username', async (req, res) => {
  const { username } = req.params;
  console.log(`🔍 Синхронизация: ${username}`);

  try {
    console.log('📡 Проверяем профиль...');
    const { isPrivate, profile } = await checkAccountPrivacy(username);

    if (!profile) {
      return res.status(404).json({ error: 'Профиль не найден' });
    }

    console.log(`✅ Найден профиль: ${profile.username}, подписчиков: ${profile.followersCount || 0}`);
    console.log(`🔒 Приватный аккаунт: ${isPrivate ? 'ДА' : 'НЕТ'}`);

    // Сохраняем пользователя
    let userResult = await pool.query(
      `SELECT id FROM users WHERE instagram_username = $1`,
      [username]
    );

    let userId;
    const profilePic = profile.profilePicUrl || profile.avatar || profile.profile_pic_url || '';
    const followers = profile.followersCount || profile.followers || 0;
    const displayName = profile.fullName || profile.username || username;

    if (userResult.rows.length === 0) {
      const newUser = await pool.query(
        `INSERT INTO users (instagram_username, username, profile_pic, followers, is_private) 
         VALUES ($1, $2, $3, $4, $5) 
         RETURNING id`,
        [username, displayName, profilePic, followers, isPrivate]
      );
      userId = newUser.rows[0].id;
    } else {
      userId = userResult.rows[0].id;
      await pool.query(
        `UPDATE users SET 
          username = $1,
          profile_pic = $2,
          followers = $3,
          is_private = $4
        WHERE id = $5`,
        [displayName, profilePic, followers, isPrivate, userId]
      );
    }

    let posts = [];
    let isMockData = false;
    let usedActor = null;

    if (isPrivate) {
      console.log('🔒 Аккаунт приватный - используем демо-данные');
      posts = generateMockReels(username, 8);
      isMockData = true;
    } else {
      console.log('🌐 Аккаунт публичный, получаем реальные посты...');
      
      const result = await getInstagramReels(username);
      
      if (result.posts && result.posts.length > 0) {
        usedActor = result.usedActor;
        console.log(`📹 Получено ${result.posts.length} постов через ${usedActor}`);
        
        // Извлекаем данные
        const extractedPosts = result.posts.map(post => extractVideoData(post));
        
        // Фильтруем видео
        const videoPosts = extractedPosts.filter(p => p.isVideo);
        console.log(`🎥 Найдено ${videoPosts.length} видео из ${extractedPosts.length} постов`);
        
        if (videoPosts.length > 0) {
          posts = videoPosts;
        } else {
          console.log('⚠️ Видео не найдены в полученных постах');
          // Показываем все посты, даже если не видео
          posts = extractedPosts.slice(0, 10);
        }
      } else {
        console.log('⚠️ Не удалось получить посты через Apify');
        console.log('💡 Проверьте:');
        console.log('   1. Правильно ли указан username?');
        console.log('   2. Доступен ли аккаунт?');
        console.log('   3. Работает ли Apify токен?');
        
        // Генерируем демо-данные с предупреждением
        posts = generateMockReels(username, 8);
        isMockData = true;
      }
    }

    // Если постов всё равно нет - генерируем демо
    if (posts.length === 0) {
      console.log('⚠️ Постов нет, генерируем демо-данные');
      posts = generateMockReels(username, 8);
      isMockData = true;
    }

    console.log(`📹 Всего постов для сохранения: ${posts.length}`);

    // Удаляем старые и сохраняем новые
    await pool.query(`DELETE FROM reels WHERE user_id = $1`, [userId]);

    let synced = 0;
    for (const post of posts) {
      if (!post.id) continue;

      await pool.query(
        `INSERT INTO reels (
          user_id, instagram_id, media_url, thumbnail_url, 
          caption, view_count, like_count, comment_count, timestamp
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          userId,
          post.id,
          post.videoUrl || '',
          post.thumbnail || '',
          post.caption ? post.caption.slice(0, 500) : 'Без описания',
          post.views || 0,
          post.likes || 0,
          post.comments || 0,
          post.timestamp || new Date()
        ]
      );
      synced++;
    }

    console.log(`✅ Синхронизировано: ${synced} постов${isMockData ? ' (⚠️ демо-данные, так как не удалось получить реальные)' : ` (✅ реальные данные через ${usedActor})`}`);

    const reelsData = await pool.query(
      `SELECT 
        r.*, 
        u.instagram_username, 
        u.profile_pic, 
        u.followers,
        u.is_private
       FROM reels r 
       JOIN users u ON r.user_id = u.id 
       WHERE u.instagram_username = $1
       ORDER BY r.timestamp DESC`,
      [username]
    );

    res.json({
      success: true,
      synced,
      isPrivate,
      isMockData,
      usedActor,
      user: {
        username: profile.username || username,
        fullName: profile.fullName || profile.username || username,
        followers: profile.followersCount || profile.followers || 0,
        profile_pic: profile.profilePicUrl || profile.avatar || profile.profile_pic_url || '',
        is_private: isPrivate
      },
      reels: reelsData.rows,
      message: isMockData 
        ? '⚠️ Используются демо-данные (не удалось получить реальные посты)' 
        : `✅ Данные успешно загружены через ${usedActor}`
    });

  } catch (err) {
    console.error('❌ Ошибка:', err.message);
    console.error(err.stack);
    res.status(500).json({ error: err.message });
  }
});

function generateMockReels(username, count = 8) {
  const captions = [
    '🔥 Новый рилс! #instagram #reels',
    '💪 Мотивация на каждый день',
    '🎵 Под этот трек хочется танцевать',
    '✨ Магия момента',
    '🏆 Достижения и победы',
    '🎥 За кулисами съемок',
    '💫 Вдохновение вокруг нас',
    '🌟 Свет и тени'
  ];
  
  return Array.from({ length: count }, (_, i) => ({
    id: `mock_${Date.now()}_${i}`,
    thumbnail: `https://picsum.photos/seed/${username}_${i}_reel/300/534`,
    videoUrl: '',
    caption: captions[i % captions.length],
    views: Math.floor(Math.random() * 25000 + 1000),
    likes: Math.floor(Math.random() * 3000 + 100),
    comments: Math.floor(Math.random() * 300 + 10),
    timestamp: new Date(Date.now() - i * 86400000 - Math.random() * 86400000),
    isVideo: true,
    isMock: true
  }));
}

// Статистика
app.get('/api/stats', async (req, res) => {
  try {
    const total = await pool.query('SELECT COUNT(*) FROM reels');
    const views = await pool.query('SELECT SUM(view_count) FROM reels');
    const likes = await pool.query('SELECT SUM(like_count) FROM reels');
    const users = await pool.query('SELECT COUNT(*) FROM users');
    const top = await pool.query(`
      SELECT r.caption, r.view_count, r.thumbnail_url, u.instagram_username, u.profile_pic
      FROM reels r 
      JOIN users u ON r.user_id = u.id 
      ORDER BY r.view_count DESC 
      LIMIT 5
    `);
    res.json({
      totalReels: parseInt(total.rows[0].count || 0),
      totalViews: parseInt(views.rows[0].sum || 0),
      totalLikes: parseInt(likes.rows[0].sum || 0),
      totalUsers: parseInt(users.rows[0].count || 0),
      topReels: top.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Удаление пользователя
app.delete('/api/user/:username', async (req, res) => {
  const { username } = req.params;
  try {
    await pool.query('DELETE FROM reels WHERE user_id = (SELECT id FROM users WHERE instagram_username = $1)', [username]);
    await pool.query('DELETE FROM users WHERE instagram_username = $1', [username]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  console.log(`📊 Apify токен: ${APIFY_TOKEN ? '✅' : '❌'}`);
});