const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { ApifyClient } = require('apify-client');
const axios = require('axios'); // <-- ДОБАВЬТЕ ЭТУ СТРОКУ
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

// Функция для получения постов с разных акторов
async function getInstagramPosts(username, limit = 50) {
  let allPosts = [];
  let usedActors = [];
  
  const actors = [
    {
      name: 'apify/instagram-post-scraper',
      call: async () => {
        const run = await apifyClient.actor('apify/instagram-post-scraper').call({
          usernames: [username],
          resultsLimit: limit,
          resultsType: 'posts',
        });
        const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();
        return items;
      }
    },
    {
      name: 'apify/instagram-scraper',
      call: async () => {
        const run = await apifyClient.actor('apify/instagram-scraper').call({
          usernames: [username],
          resultsLimit: limit,
          maxItems: limit,
        });
        const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();
        return items;
      }
    },
    {
      name: 'lukas/instagram-scraper',
      call: async () => {
        const run = await apifyClient.actor('lukas/instagram-scraper').call({
          usernames: [username],
          resultsLimit: limit,
        });
        const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();
        return items;
      }
    }
  ];

  for (const actor of actors) {
    try {
      console.log(`🔄 Пробуем ${actor.name}...`);
      const items = await actor.call();
      if (items && items.length > 0) {
        allPosts = items;
        usedActors.push(actor.name);
        console.log(`✅ ${actor.name} вернул ${items.length} постов`);
        break;
      }
    } catch (err) {
      console.log(`❌ ${actor.name} не сработал:`, err.message);
    }
  }

  return { posts: allPosts, usedActors };
}

function extractVideoData(post) {
  const thumbnail = 
    post.displayUrl || 
    post.display_url || 
    post.thumbnailUrl || 
    post.thumbnail_url || 
    post.thumbnail || 
    post.cover || 
    post.imageUrl ||
    post.image_url ||
    (post.carousel_media && post.carousel_media[0]?.image_versions2?.candidates?.[0]?.url) ||
    (post.image_versions2 && post.image_versions2.candidates && post.image_versions2.candidates[0]?.url) ||
    '';

  const videoUrl = 
    post.videoUrl || 
    post.video_url || 
    post.video || 
    (post.video_versions && post.video_versions[0]?.url) ||
    '';

  let caption = '';
  if (post.caption) {
    if (typeof post.caption === 'string') caption = post.caption;
    else if (typeof post.caption === 'object' && post.caption.text) caption = post.caption.text;
  } else if (post.text) {
    caption = post.text;
  } else if (post.description) {
    caption = post.description;
  }

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
    0;

  const comments = 
    post.commentsCount || 
    post.comment_count || 
    post.comments || 
    0;

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
    (post.video_versions && post.video_versions.length > 0);

  return {
    id: post.id || `post_${Date.now()}`,
    thumbnail,
    videoUrl,
    caption,
    views: parseInt(views) || 0,
    likes: parseInt(likes) || 0,
    comments: parseInt(comments) || 0,
    timestamp,
    isVideo,
    isMock: false
  };
}

function generateMockReels(username, count = 12) {
  const captions = [
    '🔥 Новый рилс! #instagram #reels',
    '💪 Мотивация на каждый день',
    '🎵 Под этот трек хочется танцевать',
    '✨ Магия момента',
    '🏆 Достижения и победы',
    '🎥 За кулисами съемок',
    '💫 Вдохновение вокруг нас',
    '🌟 Свет и тени',
    '🎶 Музыка в душе',
    '📸 Момент из жизни',
    '❤️ Любовь и страсть',
    '🌊 Волна эмоций'
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

    if (isPrivate) {
      console.log('🔒 Аккаунт приватный, генерируем демо-данные...');
      posts = generateMockReels(username, 12);
      isMockData = true;
    } else {
      console.log('🌐 Аккаунт публичный, получаем посты...');
      
      const { posts: fetchedPosts, usedActors } = await getInstagramPosts(username, 50);
      
      if (fetchedPosts && fetchedPosts.length > 0) {
        console.log(`📹 Получено ${fetchedPosts.length} постов через ${usedActors.join(', ')}`);
        
        posts = fetchedPosts.map(post => extractVideoData(post));
        const videoPosts = posts.filter(p => p.isVideo);
        console.log(`🎥 Найдено ${videoPosts.length} видео из ${posts.length} постов`);
        
        if (videoPosts.length === 0) {
          console.log('⚠️ Видео не найдены, генерируем демо-данные...');
          posts = generateMockReels(username, 8);
          isMockData = true;
        } else {
          posts = videoPosts;
        }
      } else {
        console.log('⚠️ Постов не получено, генерируем демо-данные...');
        posts = generateMockReels(username, 8);
        isMockData = true;
      }
    }

    console.log(`📹 Всего постов для сохранения: ${posts.length}`);

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

    console.log(`✅ Синхронизировано: ${synced} постов${isMockData ? ' (демо-данные)' : ''}`);

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
      user: {
        username: profile.username || username,
        fullName: profile.fullName || profile.username || username,
        followers: profile.followersCount || profile.followers || 0,
        profile_pic: profile.profilePicUrl || profile.avatar || profile.profile_pic_url || '',
        is_private: isPrivate
      },
      reels: reelsData.rows,
      message: isPrivate ? '⚠️ Аккаунт приватный, показаны демо-данные' : '✅ Данные успешно загружены'
    });

  } catch (err) {
    console.error('❌ Ошибка:', err.message);
    console.error(err.stack);
    res.status(500).json({ error: err.message });
  }
});

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