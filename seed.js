/**
 * Seed script â populates the database with demo users, posts, tags, comments, and media.
 * Run with: npm run seed
 */

const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { getDb, initializeDatabase } = require('./database');

function seed() {
  initializeDatabase();
  const db = getDb();

  console.log('Seeding database...\n');

  // Clear existing data
  db.exec('DELETE FROM activity_log');
  db.exec('DELETE FROM notifications');
  db.exec('DELETE FROM post_versions');
  db.exec('DELETE FROM comments');
  db.exec('DELETE FROM post_tags');
  db.exec('DELETE FROM media');
  db.exec('DELETE FROM posts');
  db.exec('DELETE FROM tags');
  db.exec('DELETE FROM user_client_orgs');
  db.exec('DELETE FROM client_orgs');
  db.exec('DELETE FROM users');

  // === Users ===
  const users = [
    { id: uuidv4(), email: 'admin@contentflow.io', password: bcrypt.hashSync('admin123', 10), name: 'Sarah Chen', role: 'super_admin', avatar_color: '#3B82F6' },
    { id: uuidv4(), email: 'manager@contentflow.io', password: bcrypt.hashSync('manager123', 10), name: 'Alex Rivera', role: 'manager', avatar_color: '#8B5CF6' },
    { id: uuidv4(), email: 'client@contentflow.io', password: bcrypt.hashSync('client123', 10), name: 'Jordan Taylor', role: 'client', avatar_color: '#10B981' },
    { id: uuidv4(), email: 'editor@contentflow.io', password: bcrypt.hashSync('editor123', 10), name: 'Morgan Lee', role: 'manager', avatar_color: '#EC4899' },
    { id: uuidv4(), email: 'client2@contentflow.io', password: bcrypt.hashSync('client123', 10), name: 'Casey Brooks', role: 'client', avatar_color: '#F59E0B' },
  ];

  const insertUser = db.prepare('INSERT INTO users (id, email, password, name, role, avatar_color) VALUES (?, ?, ?, ?, ?, ?)');
  users.forEach(u => insertUser.run(u.id, u.email, u.password, u.name, u.role, u.avatar_color));
  console.log(`  â ${users.length} users created`);

  // === Client Orgs ===
  const orgs = [
    { id: uuidv4(), name: 'NeuLuma Studios' },
    { id: uuidv4(), name: 'Sunrise Fitness' },
    { id: uuidv4(), name: 'TechVibe Co' },
  ];

  const insertOrg = db.prepare('INSERT INTO client_orgs (id, name) VALUES (?, ?)');
  orgs.forEach(o => insertOrg.run(o.id, o.name));

  // Link users to orgs
  const insertLink = db.prepare('INSERT INTO user_client_orgs (user_id, client_org_id) VALUES (?, ?)');
  // Admin & manager see all
  users.filter(u => u.role !== 'client').forEach(u => orgs.forEach(o => insertLink.run(u.id, o.id)));
  // Client users
  insertLink.run(users[2].id, orgs[0].id); // Jordan â NeuLuma
  insertLink.run(users[4].id, orgs[1].id); // Casey â Sunrise Fitness
  console.log(`  â ${orgs.length} client organizations created`);

  // === Tags ===
  const tags = [
    { id: uuidv4(), name: 'Campaign Q2', color: '#3B82F6' },
    { id: uuidv4(), name: 'Product Launch', color: '#EF4444' },
    { id: uuidv4(), name: 'Brand Awareness', color: '#10B981' },
    { id: uuidv4(), name: 'Holiday', color: '#F59E0B' },
    { id: uuidv4(), name: 'Testimonial', color: '#8B5CF6' },
    { id: uuidv4(), name: 'Behind the Scenes', color: '#EC4899' },
    { id: uuidv4(), name: 'Tutorial', color: '#06B6D4' },
    { id: uuidv4(), name: 'Promo', color: '#F97316' },
  ];

  const insertTag = db.prepare('INSERT INTO tags (id, name, color) VALUES (?, ?, ?)');
  tags.forEach(t => insertTag.run(t.id, t.name, t.color));
  console.log(`  â ${tags.length} tags created`);

  // === Posts ===
  const samplePosts = [
    {
      title: 'Summer Collection Reveal â Teaser Reel',
      caption: 'Get ready for something fresh. Our Summer 2026 collection drops this Friday. Bold colors, clean lines, and made for the moment. Stay tuned.',
      hashtags: '#SummerCollection #NewDrop #FashionForward #ComingSoon',
      platform: 'instagram', aspect_ratio: '9:16', status: 'pending', priority: 'high',
      media: [{ type: 'vimeo', url: 'https://vimeo.com/824804225' }],
      tags: [0, 0], // Campaign Q2, Product Launch
    },
    {
      title: 'Morning Routine â 60 Second Workout',
      caption: 'Start your morning right with this quick 60-second energizer. No equipment needed. Just you and the motivation to move.',
      hashtags: '#MorningWorkout #FitnessMotivation #QuickWorkout #HealthyLiving',
      platform: 'tiktok', aspect_ratio: '9:16', status: 'approved', priority: 'normal',
      media: [{ type: 'vimeo', url: 'https://vimeo.com/783455878' }],
      tags: [2, 6], // Brand Awareness, Tutorial
    },
    {
      title: 'Product Deep Dive â Smart Home Hub Pro',
      caption: 'Everything you need to know about the Smart Home Hub Pro. In this video, we break down the top 5 features that set it apart from the competition.',
      hashtags: '#SmartHome #TechReview #ProductDemo #Innovation',
      platform: 'youtube', aspect_ratio: '16:9', status: 'in_review', priority: 'high',
      media: [{ type: 'youtube_link', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }],
      tags: [1, 6], // Product Launch, Tutorial
    },
    {
      title: 'Customer Spotlight â Maria\'s Transformation',
      caption: 'Maria lost 30 lbs in 6 months with our program. Hear her incredible story and what kept her motivated through the journey.',
      hashtags: '#CustomerStory #Transformation #FitnessJourney #RealResults',
      platform: 'facebook', aspect_ratio: '16:9', status: 'needs_revision', priority: 'normal',
      media: [{ type: 'image', url: 'https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?w=800&h=450&fit=crop' }],
      tags: [4, 2], // Testimonial, Brand Awareness
    },
    {
      title: 'Behind the Scenes â Studio Day',
      caption: 'A sneak peek into our latest photoshoot. The energy, the creativity, the chaos. This is where the magic happens.',
      hashtags: '#BTS #BehindTheScenes #StudioLife #ContentCreation',
      platform: 'instagram', aspect_ratio: '1:1', status: 'approved', priority: 'low',
      media: [
        { type: 'image', url: 'https://images.unsplash.com/photo-1558618666-fcd25c85f82e?w=800&h=800&fit=crop' },
        { type: 'image', url: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=800&h=800&fit=crop' }
      ],
      tags: [5], // Behind the Scenes
    },
    {
      title: 'Flash Sale Announcement â 48 Hours Only',
      caption: '48 HOURS ONLY. Up to 50% off everything in store. Don\'t miss out â this won\'t last. Link in bio.',
      hashtags: '#FlashSale #LimitedTime #ShopNow #Deals',
      platform: 'multi', aspect_ratio: '4:5', status: 'scheduled', priority: 'urgent',
      scheduled_date: '2026-04-10T09:00:00',
      media: [{ type: 'image', url: 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=640&h=800&fit=crop' }],
      tags: [7, 0], // Promo, Campaign Q2
    },
    {
      title: 'How-To: Perfect Smoothie Bowl',
      caption: 'Level up your breakfast game. Follow along as we make the ultimate smoothie bowl packed with superfoods, fresh fruit, and good vibes.',
      hashtags: '#SmoothieBowl #HealthyEating #Tutorial #FoodContent',
      platform: 'tiktok', aspect_ratio: '9:16', status: 'draft', priority: 'low',
      media: [{ type: 'image', url: 'https://images.unsplash.com/photo-1590301157890-4810ed352733?w=450&h=800&fit=crop' }],
      tags: [6], // Tutorial
    },
    {
      title: 'Team Highlight â Meet Our Head of Design',
      caption: 'Meet Priya, the creative mind behind our visual identity. From mood boards to final campaigns, she brings every idea to life.',
      hashtags: '#TeamSpotlight #MeetTheTeam #CreativeTeam #DesignLife',
      platform: 'instagram', aspect_ratio: '4:5', status: 'pending', priority: 'normal',
      media: [{ type: 'image', url: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=640&h=800&fit=crop' }],
      tags: [5, 2], // Behind the Scenes, Brand Awareness
    },
    {
      title: 'Holiday Gift Guide 2026',
      caption: 'Stuck on what to gift this year? We\'ve curated the ultimate gift guide with picks for everyone on your list. Start shopping now.',
      hashtags: '#GiftGuide #HolidayShopping #GiftIdeas #Holiday2026',
      platform: 'youtube', aspect_ratio: '16:9', status: 'rejected', priority: 'normal',
      media: [{ type: 'youtube_link', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }],
      tags: [3, 7], // Holiday, Promo
    },
    {
      title: 'Yoga Flow for Beginners â 10 Minute Session',
      caption: 'New to yoga? Start here. This gentle 10-minute flow is designed to build flexibility, reduce stress, and center your mind.',
      hashtags: '#YogaForBeginners #MindfulMovement #WellnessJourney #YogaFlow',
      platform: 'instagram', aspect_ratio: '9:16', status: 'posted', priority: 'normal',
      posted_date: '2026-04-01T10:00:00',
      media: [{ type: 'vimeo', url: 'https://vimeo.com/783455878' }],
      tags: [6, 2], // Tutorial, Brand Awareness
    },
    {
      title: 'App Update v3.2 â New Features Walkthrough',
      caption: 'Version 3.2 is here! See the new dashboard, improved search, dark mode, and faster load times in action.',
      hashtags: '#AppUpdate #NewFeatures #ProductUpdate #TechNews',
      platform: 'multi', aspect_ratio: '16:9', status: 'in_review', priority: 'high',
      media: [{ type: 'image', url: 'https://images.unsplash.com/photo-1551650975-87deedd944c3?w=800&h=450&fit=crop' }],
      tags: [1, 0], // Product Launch, Campaign Q2
    },
    {
      title: 'Weekend Vibes â Playlist & Mood',
      caption: 'The weekend is calling. Turn up the volume, grab your favorite drink, and let the vibes carry you into the sunset.',
      hashtags: '#WeekendVibes #MoodBoard #Lifestyle #GoodVibesOnly',
      platform: 'tiktok', aspect_ratio: '9:16', status: 'pending', priority: 'low',
      media: [{ type: 'image', url: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=450&h=800&fit=crop' }],
      tags: [2], // Brand Awareness
    },
  ];

  const insertPost = db.prepare(`
    INSERT INTO posts (id, title, caption, hashtags, platform, aspect_ratio, status, approval_status, priority, client_org_id, created_by, scheduled_date, posted_date, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))
  `);
  const insertMedia = db.prepare('INSERT INTO media (id, post_id, type, url, sort_order) VALUES (?, ?, ?, ?, ?)');
  const insertPostTag = db.prepare('INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)');
  const insertVersion = db.prepare(`
    INSERT INTO post_versions (id, post_id, version, title, caption, hashtags, changed_by, change_note)
    VALUES (?, ?, 1, ?, ?, ?, ?, 'Initial version')
  `);
  const insertActivity = db.prepare(`
    INSERT INTO activity_log (id, post_id, user_id, action, details, created_at)
    VALUES (?, ?, ?, 'created', ?, datetime('now', ?))
  `);

  const approvalMap = {
    draft: 'pending', pending: 'pending', in_review: 'pending',
    needs_revision: 'needs_revision', approved: 'approved',
    scheduled: 'approved', posted: 'approved', rejected: 'rejected'
  };

  samplePosts.forEach((p, index) => {
    const postId = uuidv4();
    const creatorIdx = index % 2 === 0 ? 0 : 1; // Alternate between admin and manager
    const orgIdx = index % orgs.length;
    const timeOffset = `-${(samplePosts.length - index) * 2} hours`;

    insertPost.run(
      postId, p.title, p.caption, p.hashtags, p.platform, p.aspect_ratio,
      p.status, approvalMap[p.status], p.priority, orgs[orgIdx].id,
      users[creatorIdx].id, p.scheduled_date || null, p.posted_date || null, timeOffset
    );

    // Media
    p.media.forEach((m, mi) => {
      insertMedia.run(uuidv4(), postId, m.type, m.url, mi);
    });

    // Tags
    if (p.tags) {
      p.tags.forEach(tagIdx => {
        if (tags[tagIdx]) insertPostTag.run(postId, tags[tagIdx].id);
      });
    }

    // Version & activity
    insertVersion.run(uuidv4(), postId, p.title, p.caption, p.hashtags, users[creatorIdx].id);
    insertActivity.run(uuidv4(), postId, users[creatorIdx].id, `Post "${p.title}" created`, timeOffset);
  });

  console.log(`  â ${samplePosts.length} posts with media, tags, and activity created`);

  // === Sample Comments ===
  const allPosts = db.prepare('SELECT id, title FROM posts LIMIT 8').all();
  const insertComment = db.prepare('INSERT INTO comments (id, post_id, user_id, content, created_at) VALUES (?, ?, ?, ?, datetime("now", ?))');

  const sampleComments = [
    { userIdx: 2, content: 'Love the direction on this! The colors really pop. Approved from our side.', offset: '-5 hours' },
    { userIdx: 1, content: 'Great work on the copy. Can we make the CTA a bit more prominent?', offset: '-4 hours' },
    { userIdx: 0, content: 'Updated the thumbnail â let me know if this version works better.', offset: '-3 hours' },
    { userIdx: 2, content: 'Can we swap the background music? Something a bit more upbeat would match our brand.', offset: '-2 hours' },
    { userIdx: 3, content: 'The hashtag strategy looks solid. I\'d add #SummerReady as well.', offset: '-1 hours' },
    { userIdx: 4, content: 'This looks fantastic! Can we schedule it for next Tuesday morning?', offset: '-30 minutes' },
  ];

  let commentCount = 0;
  allPosts.forEach((post, pi) => {
    const numComments = Math.min(sampleComments.length, 2 + (pi % 3));
    for (let i = 0; i < numComments; i++) {
      const c = sampleComments[(pi + i) % sampleComments.length];
      insertComment.run(uuidv4(), post.id, users[c.userIdx].id, c.content, c.offset);
      commentCount++;
    }
  });

  console.log(`  â ${commentCount} comments added`);

  // === Sample Notifications ===
  const insertNotif = db.prepare('INSERT INTO notifications (id, user_id, type, title, message, post_id) VALUES (?, ?, ?, ?, ?, ?)');
  insertNotif.run(uuidv4(), users[0].id, 'comment', 'New Comment', 'Jordan Taylor commented on "Summer Collection Reveal"', allPosts[0]?.id);
  insertNotif.run(uuidv4(), users[0].id, 'approval', 'Post Approved', '"Morning Routine" has been approved by the client', allPosts[1]?.id);
  insertNotif.run(uuidv4(), users[2].id, 'revision', 'Revision Requested', 'Alex Rivera requested changes on "Customer Spotlight"', allPosts[3]?.id);
  insertNotif.run(uuidv4(), users[1].id, 'comment', 'New Reply', 'Sarah Chen replied to your comment', allPosts[2]?.id);
  console.log('  â Sample notifications created');

  console.log('\n  â Seed complete! Start the server with: npm start\n');
  console.log('  Demo Accounts:');
  console.log('  âââââââââââââââââââââââââââââââââââââââââ');
  console.log('  Super Admin: admin@contentflow.io / admin123');
  console.log('  Manager:     manager@contentflow.io / manager123');
  console.log('  Client:      client@contentflow.io / client123');
  console.log('');

  process.exit(0);
}

seed();

