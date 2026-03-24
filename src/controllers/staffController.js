const getMyStaffInfo = async (req, res) => {
  const client = await pool.connect()

  try {
    const { shop_id } = req.user

    const result = await client.query(
      `
      SELECT 
        u.id,
        u.full_name,
        u.phone,
        u.is_active,
        u.is_online,
        u.last_login_at,
        u.last_logout_at,
        u.last_login_device,
        u.created_at,
        d.device_id
      FROM users u
      LEFT JOIN devices d ON d.user_id = u.id
      WHERE u.shop_id = $1
        AND u.role = 'STAFF'
      ORDER BY u.created_at DESC
      `,
      [shop_id]
    )

    res.json({
      success: true,
      staff: result.rows
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({
      success: false,
      message: 'Failed to fetch staff'
    })
  } finally {
    client.release()
  }
}

module.exports = {
    getMyStaffInfo
};