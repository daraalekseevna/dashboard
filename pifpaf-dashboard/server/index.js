const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const axios = require('axios');
const cheerio = require('cheerio');
require('dotenv').config();

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const PORT = process.env.PORT || 5000;

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 5432,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
});

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
        is_private BOOLEAN DEFAULT false,
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

// ===== ПАРСИНГ INSTAGRAM СТРАНИЦЫ =====
async function parseInstagramProfile(username) {
  try {
    console.log(`🌐 Парсим страницу instagram.com/${username}...`);
    
    const response = await axios({
      method: 'GET',
      url: `https://www.instagram.com/${username}/`,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Cache-Control': 'max-age=0',
        'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1'
      },
      timeout: 30000
    });

    const html = response.data;
    const $ = cheerio.load(html);

    // Ищем JSON с данными в скрипте
    let profileData = null;
    let postsData = [];

    // Ищем скрипт с данными
    const scripts = $('script').get();
    for (const script of scripts) {
      const content = $(script).html();
      if (content && content.includes('window._sharedData')) {
        try {
          const match = content.match(/window\._sharedData = (.*?);<\/script>/s);
          if (match) {
            const data = JSON.parse(match[1]);
            if (data?.entry_data?.ProfilePage?.[0]?.graphql?.user) {
              const user = data.entry_data.ProfilePage[0].graphql.user;
              profileData = {
                id: user.id,
                username: user.username,
                fullName: user.full_name,
                profilePic: user.profile_pic_url_hd || user.profile_pic_url,
                followers: user.edge_followed_by?.count || 0,
                isPrivate: user.is_private || false,
                posts: user.edge_owner_to_timeline_media?.edges || []
              };
              
              // Извлекаем посты
              postsData = profileData.posts.map(edge => edge.node);
              break;
            }
          }
        } catch (e) {
          console.log('⚠️ Ошибка парсинга скрипта:', e.message);
        }
      }
    }

    if (!profileData) {
      console.log('⚠️ Не удалось найти данные в скрипте, пробуем найти через JSON в теле');
      
      // Альтернативный поиск
      const jsonMatch = html.match(/<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/g);
      if (jsonMatch) {
        for (const match of jsonMatch) {
          try {
            const content = match.replace(/<script[^>]*>/, '').replace(/<\/script>/, '');
            const data = JSON.parse(content);
            if (data?.graphql?.user) {
              const user = data.graphql.user;
              profileData = {
                id: user.id,
                username: user.username,
                fullName: user.full_name,
                profilePic: user.profile_pic_url_hd || user.profile_pic_url,
                followers: user.edge_followed_by?.count || 0,
                isPrivate: user.is_private || false,
                posts: user.edge_owner_to_timeline_media?.edges || []
              };
              postsData = profileData.posts.map(edge => edge.node);
              break;
            }
          } catch (e) {
            // Продолжаем поиск
          }
        }
      }
    }

    return { profile: profileData, posts: postsData };

  } catch (error) {
    console.error('❌ Ошибка парсинга:', error.message);
    return { profile: null, posts: [] };
  }
}

// ===== ИЗВЛЕЧЕНИЕ ДАННЫХ ИЗ ПОСТА =====
function extractPostData(post) {
  // Обложка
  let thumbnail = '';
  if (post.display_url) {
    thumbnail = post.display_url;
  } else if (post.thumbnail_src) {
    thumbnail = post.thumbnail_src;
  } else if (post.display_src) {
    thumbnail = post.display_src;
  }

  // Видео URL
  let videoUrl = '';
  if (post.video_url) {
    videoUrl = post.video_url;
  } else if (post.video_versions && post.video_versions.length > 0) {
    videoUrl = post.video_versions[0].url;
  }

  // Описание
  let caption = '';
  if (post.edge_media_to_caption?.edges?.length > 0) {
    caption = post.edge_media_to_caption.edges[0].node.text;
  } else if (post.caption) {
    caption = post.caption;
  }

  // Дата
  let timestamp = new Date();
  if (post.taken_at_timestamp) {
    timestamp = new Date(post.taken_at_timestamp * 1000);
  } else if (post.date) {
    timestamp = new Date(post.date);
  }

  // Статистика
  const likes = post.edge_media_preview_like?.count || 0;
  const comments = post.edge_media_to_comment?.count || 0;
  const views = post.video_view_count || post.play_count || 0;

  // Проверяем, что это видео
  const isVideo = post.is_video === true || post.__typename === 'GraphVideo' || !!videoUrl;

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

// ===== СИНХРОНИЗАЦИЯ =====
app.post('/api/sync/:username', async (req, res) => {
  const { username } = req.params;
  console.log(`\n🔍 Синхронизация: ${username}`);
  console.log('═'.repeat(50));

  try {
    console.log('📡 Парсим страницу Instagram...');
    const { profile, posts } = await parseInstagramProfile(username);

    if (!profile) {
      console.log('❌ Профиль не найден');
      return res.status(404).json({ error: 'Профиль не найден' });
    }

    console.log(`✅ Найден профиль: @${profile.username}`);
    console.log(`👥 Подписчиков: ${profile.followers}`);
    console.log(`🔒 Приватный: ${profile.isPrivate ? 'ДА' : 'НЕТ'}`);
    console.log(`📹 Найдено постов: ${posts.length}`);

    // Сохраняем пользователя
    let userResult = await pool.query(
      `SELECT id FROM users WHERE instagram_username = $1`,
      [username]
    );

    let userId;
    if (userResult.rows.length === 0) {
      const newUser = await pool.query(
        `INSERT INTO users (instagram_username, username, profile_pic, followers, is_private) 
         VALUES ($1, $2, $3, $4, $5) 
         RETURNING id`,
        [username, profile.fullName || profile.username, profile.profilePic || '', profile.followers || 0, profile.isPrivate || false]
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
        [profile.fullName || profile.username, profile.profilePic || '', profile.followers || 0, profile.isPrivate || false, userId]
      );
    }

    // Обрабатываем посты
    let allPosts = [];
    let isMockData = false;

    if (posts.length > 0) {
      console.log('📸 Обрабатываем посты...');
      
      const extractedPosts = posts.map(post => extractPostData(post));
      
      // Фильтруем видео
      const videoPosts = extractedPosts.filter(p => p.isVideo);
      console.log(`🎥 Найдено ${videoPosts.length} видео из ${extractedPosts.length} постов`);
      
      if (videoPosts.length > 0) {
        allPosts = videoPosts;
      } else {
        // Если видео нет, берем все посты
        allPosts = extractedPosts.slice(0, 15);
        console.log('📸 Видео не найдены, сохраняем все посты');
      }
    } else {
      console.log('⚠️ Постов не найдено');
      allPosts = generateMockReels(username, 8);
      isMockData = true;
    }

    if (allPosts.length === 0) {
      console.log('⚠️ Постов нет, генерируем демо-данные');
      allPosts = generateMockReels(username, 8);
      isMockData = true;
    }

    console.log(`📹 Всего постов для сохранения: ${allPosts.length}`);

    // Удаляем старые и сохраняем новые
    await pool.query(`DELETE FROM reels WHERE user_id = $1`, [userId]);

    let synced = 0;
    for (const post of allPosts) {
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

    console.log(`✅ Синхронизировано: ${synced} постов`);
    console.log('═'.repeat(50));

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
      isPrivate: profile.isPrivate || false,
      isMockData,
      user: {
        username: profile.username,
        fullName: profile.fullName || profile.username,
        followers: profile.followers || 0,
        profile_pic: profile.profilePic || '',
        is_private: profile.isPrivate || false
      },
      reels: reelsData.rows,
      message: isMockData ? '⚠️ Используются демо-данные' : '✅ Данные успешно загружены'
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
});